
import { AnalysisReport, SerializedProject, SerializedDatabase, ProjectState, EvidenceFile, ChatMessage, ProcessedContent } from "../types";
import JSZip from "jszip";

/**
 * Generates an HTML-based .doc file which Word can open perfectly.
 */
export const exportToWord = (report: AnalysisReport, projectTitle: string = "Relatório de Análise") => {
  const content = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset="utf-8">
      <title>${projectTitle}</title>
      <style>
        body { font-family: 'Calibri', 'Arial', sans-serif; line-height: 1.5; }
        h1 { mso-style-name: "Título 1"; color: #1e293b; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }
        h2 { color: #334155; margin-top: 20px; background-color: #f1f5f9; padding: 5px; }
        h3 { color: #475569; font-size: 14pt; }
        .status { font-weight: bold; }
        .status-Confirmado { color: #166534; }
        .status-Desmentido { color: #991b1b; }
        .citation { font-style: italic; color: #555; border-left: 3px solid #cbd5e1; padding-left: 10px; margin: 5px 0; }
        .timestamp { font-size: 0.9em; color: #64748b; font-weight: bold; }
        .summary { margin-bottom: 15px; }
      </style>
    </head>
    <body>
      <h1>${projectTitle}</h1>
      <p>Gerado em: ${new Date(report.generatedAt).toLocaleString('pt-PT')}</p>
      
      <h2>Conclusão Geral</h2>
      <p>${report.generalConclusion}</p>

      <hr />

      ${report.results.map(r => `
        <div class="fact-block">
          <h3>Facto: ${r.factText}</h3>
          <p class="status status-${r.status.replace(/\s/g, '')}">Parecer: ${r.status}</p>
          <div class="summary">${r.summary}</div>
          
          ${r.citations.length > 0 ? '<h4>Citações Relevantes:</h4>' : ''}
          ${r.citations.map(c => `
            <div class="citation">
              <span class="timestamp">[${c.fileName} @ ${c.timestamp}]</span>
              "${c.text}"
            </div>
          `).join('')}
        </div>
      `).join('')}
    </body>
    </html>
  `;

  const blob = new Blob(['\ufeff', content], {
    type: 'application/msword'
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${projectTitle.replace(/\s+/g, '_')}_Analise.doc`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Exports one or multiple transcripts to a Word document.
 * Multiple transcripts will be separated by page breaks and use H1 for titles.
 */
export const exportTranscriptsToWord = (transcripts: ProcessedContent[], fileName: string = "Transcrições_Veritas") => {
  if (transcripts.length === 0) return;

  const content = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset="utf-8">
      <title>${fileName}</title>
      <style>
        @page Section1 { size: 595.3pt 841.9pt; margin: 70.85pt 70.85pt 70.85pt 70.85pt; mso-header-margin: 35.4pt; mso-footer-margin: 35.4pt; mso-paper-source: 0; }
        div.Section1 { page: Section1; }
        body { font-family: 'Calibri', 'Arial', sans-serif; line-height: 1.5; color: #000; }
        h1 { 
            mso-style-name: "Título 1";
            font-size: 24pt; 
            color: #2563eb; 
            border-bottom: 2px solid #2563eb; 
            padding-bottom: 8pt; 
            margin-top: 24pt;
            margin-bottom: 12pt;
        }
        .segment { margin-bottom: 10pt; page-break-inside: avoid; }
        .timestamp { font-family: 'Consolas', 'Courier New', monospace; font-size: 9pt; color: #64748b; font-weight: bold; margin-right: 8pt; }
        .text { font-size: 11pt; }
        .page-break { page-break-after: always; }
        .meta-info { font-size: 9pt; color: #94a3b8; margin-bottom: 20pt; font-style: italic; }
      </style>
    </head>
    <body>
      <div class="Section1">
        ${transcripts.map((t, idx) => `
          <div class="${idx < transcripts.length - 1 ? 'page-break' : ''}">
            <h1>${t.fileName}</h1>
            <div class="meta-info">Transcrição processada em: ${new Date(t.processedAt).toLocaleString('pt-PT')}</div>
            
            ${t.segments.map(s => `
              <div class="segment">
                <span class="timestamp">[${s.timestamp}]</span>
                <span class="text">${s.text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')}</span>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
    </body>
    </html>
  `;

  const blob = new Blob(['\ufeff', content], {
    type: 'application/msword'
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName.replace(/\s+/g, '_')}.doc`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Exports Chat History (Single or Full) to a ZIP containing a Word doc and referenced Attachments.
 */
export const exportChatToZip = async (
    chatHistory: ChatMessage[], 
    evidenceFiles: EvidenceFile[],
    specificMessageId?: string
) => {
    const zip = new JSZip();
    
    // 1. Filter Messages
    let messagesToExport = chatHistory;
    if (specificMessageId) {
        // Find the specific AI message
        const targetIndex = chatHistory.findIndex(m => m.id === specificMessageId);
        if (targetIndex !== -1) {
            // Include the User Question immediately before it, if exists
            const prevMsg = chatHistory[targetIndex - 1];
            if (prevMsg && prevMsg.role === 'user') {
                messagesToExport = [prevMsg, chatHistory[targetIndex]];
            } else {
                messagesToExport = [chatHistory[targetIndex]];
            }
        }
    }

    // 2. Identify referenced files
    const referencedFileIds = new Set<string>();
    messagesToExport.forEach(msg => {
        // Regex to find [Filename @ Timestamp]
        const matches = msg.text.match(/\[(.*?)\s*@/g);
        if (matches) {
            matches.forEach(m => {
                const namePart = m.replace('[', '').replace('@', '').trim();
                // Find file by fuzzy name match
                const file = evidenceFiles.find(f => f.name.includes(namePart) || namePart.includes(f.name));
                if (file) referencedFileIds.add(file.id);
            });
        }
    });

    // 3. Generate Word Content (HTML)
    const wordContent = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
            <meta charset="utf-8">
            <title>Exportação Chat Veritas</title>
            <style>
                body { font-family: 'Calibri', sans-serif; }
                .message { margin-bottom: 20px; padding: 10px; border: 1px solid #ddd; }
                .role-user { background-color: #e0f2fe; color: #000; }
                .role-model { background-color: #f0fdf4; color: #000; }
                .timestamp { font-size: 0.8em; color: #666; margin-bottom: 5px; }
                .content { white-space: pre-wrap; }
            </style>
        </head>
        <body>
            <h1>Exportação de Conversa - Veritas AI</h1>
            <p>Data: ${new Date().toLocaleString()}</p>
            <hr/>
            ${messagesToExport.map(msg => `
                <div class="message role-${msg.role}">
                    <div class="timestamp"><strong>${msg.role === 'user' ? 'UTILIZADOR' : 'ASSISTENTE'}</strong> - ${new Date(msg.timestamp).toLocaleString()}</div>
                    <div class="content">${msg.text.replace(/\[\[DETECTED_PEOPLE:.*?\]\]/g, '')}</div>
                </div>
            `).join('')}
        </body>
        </html>
    `;
    
    zip.file("Conversa.doc", '\ufeff' + wordContent);

    // 4. Add Attachments
    const attachmentsFolder = zip.folder("Anexos");
    if (attachmentsFolder) {
        referencedFileIds.forEach(id => {
            const file = evidenceFiles.find(f => f.id === id);
            if (file && file.file) {
                // If it's a real file, add it
                attachmentsFolder.file(file.name, file.file);
            } else if (file && file.isVirtual) {
                // Can't export virtual files content, maybe add a text note?
                attachmentsFolder.file(`${file.name}.txt`, "Ficheiro original não disponível (Virtual).");
            }
        });
    }

    // 5. Generate and Download
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Veritas_Export_${new Date().getTime()}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

/**
 * Saves ONLY the Project data (Facts, Analysis, Chat).
 */
export const saveProjectFile = (state: ProjectState) => {
  const data: SerializedProject = {
    type: 'project_v2',
    people: state.people,
    facts: state.facts,
    savedReports: state.savedReports,
    chatHistory: state.chatHistory,
    createdAt: Date.now()
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `veritas_projeto_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Saves ONLY the Database (Transcriptions/Processed Data).
 */
export const saveDatabaseFile = (state: ProjectState, files: EvidenceFile[]) => {
  const data: SerializedDatabase = {
    type: 'database_v2',
    processedData: state.processedData,
    fileManifest: files.map(f => ({ id: f.id, name: f.name, type: f.type, category: f.category, folder: f.folder })),
    exportedAt: Date.now()
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `veritas_base_dados_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Loads a Project or Database from a JSON file.
 */
export const loadFromJSON = async (file: File): Promise<{ 
    type: 'project' | 'database' | 'unknown', 
    data: any 
}> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target?.result as string);
                if (json.type === 'project_v2') {
                    resolve({ type: 'project', data: json as SerializedProject });
                } else if (json.type === 'database_v2') {
                    resolve({ type: 'database', data: json as SerializedDatabase });
                } else {
                    resolve({ type: 'unknown', data: null });
                }
            } catch (err) {
                reject(new Error("Ficheiro inválido ou corrompido."));
            }
        };
        reader.onerror = () => reject(new Error("Erro ao ler ficheiro."));
        reader.readAsText(file);
    });
};
