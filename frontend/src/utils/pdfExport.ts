import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

export async function exportDashboardToPDF(
  elementId: string,
  filename: string,
  title: string,
  filters?: Record<string, any>
) {
  try {
    const element = document.getElementById(elementId);
    if (!element) throw new Error('Element not found');

    // Create canvas from HTML
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - 2 * margin;

    let yPosition = margin;

    // Header
    pdf.setFontSize(20);
    pdf.setTextColor(31, 41, 55); // slate-900
    pdf.text(title, margin, yPosition);
    yPosition += 10;

    // Date
    pdf.setFontSize(10);
    pdf.setTextColor(107, 114, 128); // slate-500
    pdf.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, margin, yPosition);
    yPosition += 8;

    // Filters
    if (filters && Object.keys(filters).length > 0) {
      pdf.setFontSize(9);
      pdf.setTextColor(71, 85, 105); // slate-600
      const filterText = Object.entries(filters)
        .map(([key, value]) => `${key}: ${value}`)
        .join(' • ');
      pdf.text(filterText, margin, yPosition, { maxWidth: contentWidth });
      yPosition += 6;
    }

    // Separator
    pdf.setDrawColor(226, 232, 240); // slate-200
    pdf.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 8;

    // Content
    const imgHeight = (canvas.height * contentWidth) / canvas.width;
    let remainingHeight = imgHeight;
    let pageNum = 1;

    while (remainingHeight > 0) {
      const availableHeight = pageHeight - yPosition - margin;

      if (remainingHeight <= availableHeight) {
        // Last page
        pdf.addImage(
          imgData,
          'PNG',
          margin,
          yPosition,
          contentWidth,
          remainingHeight
        );
        remainingHeight = 0;
      } else {
        // Need another page
        const heightToCrop = (availableHeight * canvas.height) / imgHeight;
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = canvas.width;
        croppedCanvas.height = heightToCrop;
        const ctx = croppedCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(
            canvas,
            0,
            (pageNum - 1) * heightToCrop,
            canvas.width,
            heightToCrop,
            0,
            0,
            canvas.width,
            heightToCrop
          );
          const croppedImgData = croppedCanvas.toDataURL('image/png');
          pdf.addImage(croppedImgData, 'PNG', margin, yPosition, contentWidth, availableHeight);
        }

        remainingHeight -= availableHeight;
        pageNum++;
        if (remainingHeight > 0) {
          pdf.addPage();
          yPosition = margin;
        }
      }
    }

    // Footer on all pages
    const totalPages = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setTextColor(156, 163, 175); // slate-400
      pdf.text(
        `Page ${i} / ${totalPages}`,
        pageWidth / 2,
        pageHeight - 8,
        { align: 'center' }
      );
    }

    pdf.save(filename);
  } catch (error) {
    console.error('PDF export failed:', error);
    throw error;
  }
}
