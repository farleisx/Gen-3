import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  if(req.method !== "POST") return res.status(405).json({ error:"Method not allowed" });

  const { userId, prompt, previousCode, instruction, costCheckOnly } = req.body;
  if(!userId || !prompt) return res.status(400).json({ error:"Missing userId or prompt" });

  try{
    // ======== CREDIT LOGIC ========
    let cost = previousCode || instruction ? 0.25 : 0.5;
    let { data: userData } = await supabase.from("credits").select("*").eq("user_id", userId).single();
    const now = new Date();
    let creditsLeft = 5;

    if(userData){
      const lastReset = new Date(userData.last_reset);
      if(now - lastReset > 24*60*60*1000) creditsLeft = 5; 
      else creditsLeft = userData.credits;
    }

    if(costCheckOnly) return res.status(200).json({ creditsLeft });

    if(creditsLeft < cost) return res.status(400).json({ error:"Not enough credits" });
    creditsLeft -= cost;

    if(userData){
      await supabase.from("credits").update({ credits: creditsLeft, last_reset: now }).eq("user_id", userId);
    } else {
      await supabase.from("credits").insert({ user_id:userId, credits:creditsLeft, last_reset: now });
    }

    // ======== AI GENERATION ========
    const model = genAI.getGenerativeModel({ model:"gemini-2.5-flash" });
    let requestPrompt = previousCode
      ? `You are an AI code agent. Update this code:\n${previousCode}\nInstruction: ${instruction}\nRules: generate code only, wrap in proper markdown.`
      : `You are an AI code agent. Generate full project for:\n${prompt}\nRules: generate code only, wrap in proper markdown.`;

    const result = await model.generateContent(requestPrompt);
    const fullOutput = await result.response.text();
    if(!fullOutput || fullOutput.trim() === "") return res.status(500).json({ error:"AI returned empty output" });

    let updatedCode = previousCode ? previousCode + "\n\n" + fullOutput : fullOutput;
    res.status(200).json({ output: updatedCode, creditsLeft });

  } catch(err){
    console.error(err);
    res.status(500).json({ error:"AI request failed" });
  }
}
