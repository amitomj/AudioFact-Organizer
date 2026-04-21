
import { PDFDocument } from 'pdf-lib';

export async function splitPdf(file: File): Promise<{ pageFile: File, pageNumber: number }[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const pageCount = pdfDoc.getPageCount();
  const results: { pageFile: File, pageNumber: number }[] = [];

  for (let i = 0; i < pageCount; i++) {
    const newPdf = await PDFDocument.create();
    const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
    newPdf.addPage(copiedPage);
    const pdfBytes = await newPdf.save();
    
    const pageNumber = i + 1;
    const fileName = `${file.name.replace(/\.[^/.]+$/, "")}_Pag_${pageNumber}.pdf`;
    const pageFile = new File([pdfBytes], fileName, { type: 'application/pdf' });
    
    results.push({ pageFile, pageNumber });
  }

  return results;
}
