
import { AnalysisReport, SerializedProject, SerializedDatabase, ProjectState, EvidenceFile } from "../types";

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
        h1 { color: #1e293b; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }
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