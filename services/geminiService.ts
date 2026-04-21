
import { GoogleGenAI } from "@google/genai";
import mammoth from "mammoth";
import { EvidenceFile, EvidenceType, Fact, FactAnalysis, FactStatus, AnalysisReport, ChatMessage, ProcessedContent, Citation, Person } from "../types";

const getAI = () => {
  const apiKey = process.env.API_KEY || 
                 process.env.GEMINI_API_KEY || 
                 (window as any).process?.env?.API_KEY || 
                 (window as any).process?.env?.GEMINI_API_KEY || 
                 "";
  if (!apiKey) {
    throw new Error("API_KEY_MISSING");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Helper to call Gemini with exponential backoff for transient errors (500, 429, etc.)
 */
const callGeminiWithRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  initialDelay = 3000
): Promise<T> => {
  let lastError: any;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorStr = error.message || "";
      const isTransient = errorStr.includes('500') || 
                         errorStr.includes('INTERNAL') || 
                         errorStr.includes('Quota exceeded') ||
                         errorStr.includes('429') ||
                         errorStr.includes('deadline exceeded') ||
                         errorStr.includes('service unavailable');
      
      if (isTransient && attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.warn(`Gemini API error (attempt ${attempt + 1}/${maxRetries}): ${errorStr}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

/**
 * Converts a File object to a Base64 string for the API.
 */
const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64String = result.includes(',') ? result.split(',')[1] : result;
      
      // Fallback MIME types if file.type is empty
      let mimeType = file.type;
      if (!mimeType) {
        const name = file.name.toLowerCase();
        if (name.endsWith('.pdf')) mimeType = 'application/pdf';
        else if (name.endsWith('.docx')) mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        else if (name.endsWith('.doc')) mimeType = 'application/msword';
        else if (name.endsWith('.txt')) mimeType = 'text/plain';
        else if (name.endsWith('.mp3')) mimeType = 'audio/mpeg';
        else if (name.endsWith('.wav')) mimeType = 'audio/wav';
        else if (name.endsWith('.m4a')) mimeType = 'audio/mp4';
        else if (name.endsWith('.jpg') || name.endsWith('.jpeg')) mimeType = 'image/jpeg';
        else if (name.endsWith('.png')) mimeType = 'image/png';
        else mimeType = 'application/octet-stream';
      }

      resolve({
        inlineData: {
          data: base64String,
          mimeType: mimeType,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Cleans repetitive word loops (Stuttering Hallucinations).
 */
export const cleanRepetitiveLoops = (text: string): string => {
    if (!text) return "";
    const loopRegex = /\b(\w+)(?:[\s,.]+\1\b){3,}/gi;
    let cleaned = text.replace(loopRegex, '$1');
    const phraseLoopRegex = /(.{5,50}?)(?:[\s,.]+\1){3,}/gi;
    cleaned = cleaned.replace(phraseLoopRegex, '$1');
    return cleaned;
};

/**
 * Sanitizes the raw transcription text to remove AI hallucinations, loops, and time-travel artifacts.
 */
export const sanitizeTranscript = (rawText: string): { timestamp: string; seconds: number; text: string }[] => {
    const segments: { timestamp: string; seconds: number; text: string }[] = [];
    
    let formattedText = rawText
        .replace(/([^\n])\s*(\[\d{1,2}:\d{2}(?::\d{2})?\])/g, '$1\n$2')
        .replace(/([^\n])\s+(\d{1,2}:\d{2}:\d{2})/g, '$1\n$2')
        .replace(/([^\n])\s*(\[P[áa]g)/g, '$1\n$2')
        .replace(/(\n\s*){2,}/g, '\n'); 
    
    const lines = formattedText.split('\n');
    const timestampRegex = /(?:^|[\s\*\-\.\(\[])(?:(?:(\d{1,2}):)?(\d{1,2}):(\d{2})|P[áa]g\.?\s*(\d+)|Page\s*(\d+))(?:\]|\)|:)?[\*\-\)]*\s+(.*)/i;
    
    for (const line of lines) {
        if (line.trim().length < 2) continue;

        const match = line.match(timestampRegex);
        if (match) {
            const hours = match[1] ? parseInt(match[1]) : 0;
            const minutes = match[2] ? parseInt(match[2]) : null;
            const secondsPart = match[3] ? parseInt(match[3]) : null;
            const pageNum = match[4] || match[5] ? parseInt(match[4] || match[5]) : null;

            let metricValue = 0;
            let displayTimestamp = "";

            if (minutes !== null && secondsPart !== null) {
                metricValue = (hours * 3600) + (minutes * 60) + secondsPart;
                displayTimestamp = hours > 0 
                    ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secondsPart.toString().padStart(2, '0')}`
                    : `${minutes.toString().padStart(2, '0')}:${secondsPart.toString().padStart(2, '0')}`;
            } else if (pageNum !== null) {
                metricValue = pageNum; 
                displayTimestamp = `Pág ${pageNum}`;
            }

            let text = match[6] ? match[6].trim() : "";
            if (["subtitles by", "inaudível"].some(t => text.toLowerCase().includes(t))) continue;
            text = cleanRepetitiveLoops(text);

            if (text && text.length > 0) {
                segments.push({ timestamp: displayTimestamp, seconds: metricValue, text: text });
            }
        } else if (segments.length > 0 && line.trim().length > 0) {
            let cleanLine = cleanRepetitiveLoops(line.trim());
            if (!cleanLine.startsWith('[') && cleanLine.length > 1) {
                segments[segments.length - 1].text += " " + cleanLine;
            }
        }
    }
    return segments;
};

/**
 * Universal Processing Function: Handles Audio, PDF, and Images.
 */
export const processFile = async (evidenceFile: EvidenceFile): Promise<ProcessedContent> => {
  if (evidenceFile.isVirtual || !evidenceFile.file) {
      throw new Error("Este ficheiro é virtual e não pode ser processado.");
  }

  const APP_MAX_SIZE = 90 * 1024 * 1024;
  if (evidenceFile.file.size > APP_MAX_SIZE) {
      throw new Error(`O ficheiro "${evidenceFile.name}" excede o limite de 90MB. Por favor, comprima-o.`);
  }

  const model = "gemini-3-flash-preview"; 

  try {
        const ai = getAI();
        let rawText = "";
        
        // Handle .docx files locally with mammoth
        if (evidenceFile.name.toLowerCase().endsWith('.docx') || evidenceFile.name.toLowerCase().endsWith('.doc')) {
            try {
                const arrayBuffer = await evidenceFile.file.arrayBuffer();
                const result = await mammoth.extractRawText({ arrayBuffer });
                rawText = result.value;
            } catch (mammothError) {
                console.warn("Mammoth failed, falling back to Gemini:", mammothError);
                // Fallback to Gemini if mammoth fails
                const filePart = await fileToGenerativePart(evidenceFile.file);
                const response = await callGeminiWithRetry(() => ai.models.generateContent({
                    model: model,
                    contents: { parts: [filePart, { text: "Extrai o texto integral deste documento." }] },
                    config: { systemInstruction: "És um Assistente Legal. Extrai TODO o texto deste documento.", temperature: 0.1 }
                }));
                rawText = response.text || "";
            }
        } else {
            const systemInstruction = evidenceFile.type === 'AUDIO' 
                ? `És um Transcritor Forense Profissional. Transcreve com rigor absoluto. Diarização: usa [MM:SS] **Interlocutor:** Texto... Se não souberes o nome, usa Voz 1, Voz 2.`
                : `És um Assistente Legal. Extrai TODO o texto deste documento. Usa [Pág X] para separar páginas.`;
            
            const userPrompt = evidenceFile.type === 'AUDIO' 
                ? "Transcreve este áudio na íntegra." 
                : "Extrai o texto integral deste documento.";

            const filePart = await fileToGenerativePart(evidenceFile.file);
            const response = await callGeminiWithRetry(() => ai.models.generateContent({
                model: model,
                contents: { parts: [filePart, { text: userPrompt }] },
                config: { systemInstruction: systemInstruction, temperature: 0.1 }
            }));

            rawText = response.text || "";
        }

        const segments = sanitizeTranscript(rawText);
        if (segments.length === 0 && rawText.trim().length > 0) {
            rawText.split(/\n\s*\n/).forEach((p, idx) => {
                if (p.trim()) segments.push({ timestamp: `Parte ${idx + 1}`, seconds: idx, text: p.trim() });
            });
        }

        return {
          fileId: evidenceFile.id,
          fileName: evidenceFile.name,
          fullText: segments.map(s => `[${s.timestamp}] ${s.text}`).join('\n'),
          segments: segments,
          processedAt: Date.now()
        };
    } catch (error: any) {
        throw new Error(error.message || `Falha no processamento de ${evidenceFile.name}`);
    }
};

export const parseSecondsSafe = (timestamp: string): number => {
    if (timestamp.toLowerCase().includes('pág')) {
        return parseInt(timestamp.match(/\d+/)?.[0] || "1");
    }
    const parts = timestamp.split(':').map(Number);
    if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    if (parts.length === 2) return (parts[0] * 60) + parts[1];
    return 0;
};

/**
 * Analyze Facts from Evidence
 */
export const analyzeFactsFromEvidence = async (
  processedData: ProcessedContent[], 
  facts: Fact[],
  peopleMap: Record<string, string>,
  fileMetadata: EvidenceFile[] 
): Promise<AnalysisReport> => {
  const model = "gemini-3-pro-preview"; 

  const factsList = facts.map((f, i) => `${i + 1}. [ID: ${f.id}] ${f.text}`).join('\n');
  const evidenceContext = processedData.map(t => `<file name="${t.fileName}" person="${peopleMap[t.fileId] || "N/A"}">${t.fullText}</file>`).join('\n');

  // Updated Prompt with explicit END tags for all fields
  const systemInstruction = `És um Juiz Analista. Verifica factos cruzando evidências.
  Responde EXCLUSIVAMENTE no seguinte formato para cada facto:
  [[FACT]]
  ID: {id_do_facto}
  [[STATUS]] {Confirmado|Desmentido|Inconclusivo|Não Mencionado} [[END_STATUS]]
  [[SUMMARY]] {Explicação detalhada da conclusão baseada nas provas} [[END_SUMMARY]]
  [[EVIDENCES]] [Nome_Ficheiro @ 00:00] ou [Nome_Ficheiro @ Pág X] [[END_EVIDENCES]]
  [[END_FACT]]

  No fim de tudo:
  [[CONCLUSION]] {Parecer geral sobre o conjunto de factos} [[END_CONCLUSION]]`;

  try {
    const ai = getAI();
    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: model,
      contents: { parts: [{ text: `EVIDÊNCIAS:\n${evidenceContext}\n\nFACTOS:\n${factsList}` }] },
      config: { systemInstruction: systemInstruction, temperature: 0.1 }
    }));

    const rawText = response.text || "";
    const results: FactAnalysis[] = [];
    let generalConclusion = "Análise concluída.";
    
    const conclusionMatch = rawText.match(/\[\[CONCLUSION\]\]([\s\S]*?)\[\[END_CONCLUSION\]\]/);
    if (conclusionMatch) generalConclusion = conclusionMatch[1].trim();

    const factBlocks = rawText.split('[[FACT]]').slice(1);
    
    factBlocks.forEach(block => {
        const idMatch = block.match(/ID:\s*(.*?)(\n|\[)/);
        const statusMatch = block.match(/\[\[STATUS\]\]([\s\S]*?)\[\[END_STATUS\]\]/);
        const summaryMatch = block.match(/\[\[SUMMARY\]\]([\s\S]*?)\[\[END_SUMMARY\]\]/);
        const evidencesContentMatch = block.match(/\[\[EVIDENCES\]\]([\s\S]*?)\[\[END_EVIDENCES\]\]/);

        const citations: Citation[] = [];
        const citationRegex = /\[\s*(.*?)\s*@\s*(.*?)\s*\]/g;
        let cMatch;
        const evidenceStr = evidencesContentMatch?.[1] || "";
        
        while ((cMatch = citationRegex.exec(evidenceStr)) !== null) {
            const fileNameRef = cMatch[1].trim();
            const timeOrPageRef = cMatch[2].trim();
            
            // Try fuzzy matching file name
            const source = processedData.find(d => 
                d.fileName.toLowerCase().includes(fileNameRef.toLowerCase()) || 
                fileNameRef.toLowerCase().includes(d.fileName.toLowerCase())
            );
            
            if (source) {
                citations.push({
                    fileId: source.fileId,
                    fileName: source.fileName,
                    timestamp: timeOrPageRef,
                    seconds: parseSecondsSafe(timeOrPageRef),
                    text: "Referência à fonte."
                });
            }
        }

        if (idMatch) {
            const fId = idMatch[1].trim();
            results.push({
                factId: fId,
                factText: facts.find(f => f.id === fId)?.text || "Facto não encontrado",
                status: (statusMatch?.[1].trim() as FactStatus) || FactStatus.INCONCLUSIVE,
                summary: summaryMatch?.[1].trim() || "Análise não disponível.",
                citations
            });
        }
    });

    return { id: Date.now().toString(), name: `Relatório #${Date.now().toString().slice(-4)}`, generatedAt: new Date().toISOString(), generalConclusion, results };
  } catch (error: any) {
    throw new Error(`Erro na análise: ${error.message}`);
  }
};

/**
 * Extracts articles (artigos) from an indictment (acusação) and groups them by topic.
 */
export const extractArticlesFromIndictment = async (
  processedData: ProcessedContent[],
  onProgress?: (current: number, total: number) => void
): Promise<Fact[]> => {
  const model = "gemini-3-flash-preview"; 

  // Split data into chunks to avoid hitting output token limits and ensure all articles are captured
  const chunks: string[] = [];
  let currentChunk = "";
  const MAX_CHUNK_CHARS = 8000; // Further reduced to avoid 500 errors on large inputs

  for (const data of processedData) {
      // If a single file is already larger than MAX_CHUNK_CHARS, we need to split it
      const text = data.fullText;
      if (text.length > MAX_CHUNK_CHARS) {
          if (currentChunk) {
              chunks.push(currentChunk);
              currentChunk = "";
          }
          // Split the large text into smaller pieces
          for (let i = 0; i < text.length; i += MAX_CHUNK_CHARS) {
              chunks.push(text.substring(i, i + MAX_CHUNK_CHARS));
          }
      } else if (currentChunk.length + text.length > MAX_CHUNK_CHARS && currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = text;
      } else {
          currentChunk += (currentChunk ? "\n\n" : "") + text;
      }
  }
  if (currentChunk) chunks.push(currentChunk);

  let allArticles: Fact[] = [];
  const systemInstruction = `És um Analista Jurídico especializado em Direito Processual Penal. 
  A tua tarefa é extrair os ARTIGOS (factos articulados) de uma ACUSAÇÃO criminal.
  
  REGRAS:
  1. Identifica cada artigo numerado (ex: 1.º, 2.º, 3.º ou 1, 2, 3).
  2. Identifica AGRUPAMENTOS de artigos que tratam da mesma realidade factual.
  3. Extrai o texto INTEGRAL de cada artigo. Não resumas.
  4. Atribui um "group" (nome descritivo) a cada artigo.
  
  FORMATO DE RESPOSTA (JSON):
  [
    { "id": "art_1", "text": "Texto integral...", "group": "Contexto" },
    ...
  ]
  Retorna APENAS o JSON. Se o texto for cortado, tenta fechar o JSON corretamente.`;

  for (let i = 0; i < chunks.length; i++) {
      if (onProgress) onProgress(i + 1, chunks.length);
      
      try {
          const ai = getAI();
          const response = await callGeminiWithRetry(() => ai.models.generateContent({
              model: model,
              contents: { parts: [{ text: `TEXTO DA ACUSAÇÃO (PARTE ${i+1}/${chunks.length}):\n${chunks[i]}` }] },
              config: { 
                  systemInstruction: systemInstruction, 
                  temperature: 0.1,
                  responseMimeType: "application/json"
              }
          }));

          let textResponse = response.text || "[]";
          
          // Robust JSON repair for common truncation issues
          const repairJson = (json: string): string => {
              let repaired = json.trim();
              
              // 1. Check if we are inside a string (unterminated string fix)
              // If the last quote is after the last closing brace/bracket, we are likely in a string
              const lastQuote = repaired.lastIndexOf('"');
              const lastBrace = repaired.lastIndexOf('}');
              const lastBracket = repaired.lastIndexOf(']');
              
              if (lastQuote > lastBrace && lastQuote > lastBracket) {
                  repaired += '"'; // Close the unterminated string
              }
              
              // 2. Close objects and arrays
              let openBraces = (repaired.match(/{/g) || []).length;
              let closeBraces = (repaired.match(/}/g) || []).length;
              while (openBraces > closeBraces) {
                  repaired += '}';
                  closeBraces++;
              }
              
              let openBrackets = (repaired.match(/\[/g) || []).length;
              let closeBrackets = (repaired.match(/]/g) || []).length;
              while (openBrackets > closeBrackets) {
                  repaired += ']';
                  closeBrackets++;
              }
              
              return repaired;
          };

          try {
              const chunkArticles = JSON.parse(textResponse);
              const mapped = chunkArticles.map((item: any, idx: number) => ({
                  id: `c${i}_${item.id || idx}_${Math.random().toString(36).substr(2, 4)}`,
                  text: item.text,
                  group: item.group
              }));
              allArticles = [...allArticles, ...mapped];
          } catch (parseError) {
              console.error(`Erro ao processar JSON do chunk ${i}, a tentar reparar...`, parseError);
              try {
                  const fixedJson = repairJson(textResponse);
                  const chunkArticles = JSON.parse(fixedJson);
                  const mapped = chunkArticles.map((item: any, idx: number) => ({
                      id: `c${i}_${item.id || idx}_${Math.random().toString(36).substr(2, 4)}`,
                      text: item.text,
                      group: item.group
                  }));
                  allArticles = [...allArticles, ...mapped];
              } catch (e) {
                  console.error("Falha na reparação de JSON:", e);
                  // Last resort: regex to find complete objects
                  const matches = textResponse.match(/{[\s\S]*?}/g);
                  if (matches) {
                      const partialArticles = matches.map((m, idx) => {
                          try {
                              const obj = JSON.parse(m);
                              return {
                                  id: `c${i}_p${idx}_${Math.random().toString(36).substr(2, 4)}`,
                                  text: obj.text,
                                  group: obj.group
                              };
                          } catch { return null; }
                      }).filter(Boolean) as Fact[];
                      allArticles = [...allArticles, ...partialArticles];
                  }
              }
          }
      } catch (error) {
          console.error(`Erro crítico no chunk ${i} após retentativas:`, error);
          // Don't throw, just continue with next chunk to avoid stopping the whole process
          // But we should notify the user that some part failed
      }
  }

  // Remove potential duplicates by text content
  const uniqueArticles: Fact[] = [];
  const seenTexts = new Set<string>();
  
  for (const art of allArticles) {
      if (!art.text) continue;
      const normalized = art.text.toLowerCase().replace(/\s+/g, '');
      if (!seenTexts.has(normalized)) {
          seenTexts.add(normalized);
          uniqueArticles.push(art);
      }
  }

  return uniqueArticles;
};
/**
 * Analyzes evidence to find support for indictment articles.
 */
export const analyzeIndictmentMapping = async (
  processedData: ProcessedContent[],
  articles: Fact[],
  people: Map<string, Person>,
  evidenceFiles: EvidenceFile[]
): Promise<AnalysisReport> => {
  const model = "gemini-3.1-pro-preview"; 

  const indictmentArticles = articles.filter(f => f.isIndictment);
  if (indictmentArticles.length === 0) {
    throw new Error("Não existem artigos da acusação para mapear.");
  }

  // Filter out the indictment itself from the evidence to be analyzed
  const otherEvidence = processedData.filter(pd => {
    const file = evidenceFiles.find(f => f.id === pd.fileId);
    return file && file.category !== 'INDICTMENT';
  });

  const evidenceContext = otherEvidence.map(d => {
    const file = evidenceFiles.find(f => f.id === d.fileId);
    const person = file?.personId ? people.get(file.personId) : null;
    return `FICHEIRO: ${d.fileName}${person ? ` (Pessoa: ${person.name})` : ''}\nCONTEÚDO:\n${d.fullText}`;
  }).join('\n\n---\n\n');

  const articlesContext = indictmentArticles.map(a => `ID: ${a.id}\nGRUPO: ${a.group || 'N/A'}\nTEXTO: ${a.text}`).join('\n\n');

  const systemInstruction = `És um Analista Forense e Jurídico. A tua missão é realizar o MAPEAMENTO DE PROVA para uma ACUSAÇÃO criminal.
  
  OBJETIVO:
  Para cada ARTIGO da acusação, deves identificar quais os elementos de prova (Depoimentos ou Outros Documentos) que o sustentam ou contradizem.
  
  REGRAS DE ANÁLISE:
  1. Analisa cada artigo individualmente ou por grupos (se fizerem parte da mesma realidade).
  2. Identifica citações diretas e precisas da prova.
  3. Classifica o estado de cada artigo: "Confirmado", "Desmentido", "Inconclusivo/Contraditório" ou "Não Mencionado".
  4. Sê extremamente rigoroso com as fontes.
  
  FORMATO DE RESPOSTA (JSON):
  {
    "results": [
      {
        "factId": "id_do_artigo",
        "status": "Confirmado/Desmentido/...",
        "summary": "Explicação de como a prova sustenta este artigo.",
        "citations": [
          { "fileName": "nome", "timestamp": "00:00 ou Pág X", "text": "citação..." }
        ]
      }
    ],
    "generalConclusion": "Sintese global do mapeamento da acusação."
  }
  
  Retorna APENAS o JSON.`;

  try {
    const ai = getAI();
    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: model,
      contents: { parts: [{ text: `ARTIGOS DA ACUSAÇÃO:\n${articlesContext}\n\nEVIDÊNCIAS DISPONÍVEIS:\n${evidenceContext}` }] },
      config: { 
        systemInstruction: systemInstruction, 
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    }));

    const result = JSON.parse(response.text || "{}");
    return {
      id: Date.now().toString(),
      name: `Mapeamento da Acusação - ${new Date().toLocaleDateString()}`,
      generatedAt: new Date().toISOString(),
      results: result.results.map((r: any) => ({
        ...r,
        factText: indictmentArticles.find(a => a.id === r.factId)?.text || "Artigo não encontrado"
      })),
      generalConclusion: result.generalConclusion
    };
  } catch (error: any) {
    throw new Error(`Erro no mapeamento da acusação: ${error.message}`);
  }
};

export const chatWithEvidence = async (
  processedData: ProcessedContent[],
  history: ChatMessage[],
  currentMessage: string,
  peopleMap: Record<string, string>,
  fileMetadata: EvidenceFile[]
): Promise<string> => {
   const model = "gemini-3-flash-preview"; 
   try {
    const ai = getAI();
    const evidenceContext = processedData.map(t => `<doc name="${t.fileName}">${t.fullText}</doc>`).join('\n');
    const response = await callGeminiWithRetry(() => ai.models.generateContent({
        model: model,
        contents: { parts: [{ text: `EVIDÊNCIAS:\n${evidenceContext}\n\nPERGUNTA: ${currentMessage}\n\nCITAÇÃO SEMPRE NO FORMATO: [Nome_Ficheiro @ MM:SS] ou [Nome_Ficheiro @ Pág X]` }] },
        config: { temperature: 0.2 }
    }));
    return cleanRepetitiveLoops(response.text || "Sem resposta.");
   } catch (error: any) { throw error; }
};
