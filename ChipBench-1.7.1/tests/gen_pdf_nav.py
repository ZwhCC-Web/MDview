"""Fixture for the PDF navigation test: 40 pages with MIXED sizes, nested bookmarks, and page labels (i, ii, iii ... then 1, 2, 3 ...)."""
import io, pathlib
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, A3, landscape
from pypdf import PdfReader, PdfWriter
def build(path):
    buf = io.BytesIO(); c = canvas.Canvas(buf)
    for i in range(1, 41):
        sz = landscape(A3) if i % 7 == 0 else (A4[0], A4[1] * 1.6) if i % 11 == 0 else A4
        c.setPageSize(sz); c.setFont('Helvetica', 28); c.drawString(60, sz[1] - 90, f'PDF page {i}'); c.setFont('Helvetica', 12); c.drawString(60, sz[1] - 120, f'marker-{i}-body'); c.showPage()
    c.save(); buf.seek(0); r = PdfReader(buf); w = PdfWriter()
    for p in r.pages: w.add_page(p)
    w.add_outline_item('第 1 章 概述', 3); ch = w.add_outline_item('第 2 章 时钟', 16)
    w.add_outline_item('2.1 PLL', 16, parent=ch); w.add_outline_item('2.2 分频', 27, parent=ch); w.add_outline_item('第 3 章 附录', 38)
    w.set_page_label(0, 3, style='/r'); w.set_page_label(4, 39, style='/D', start=1); w.write(path)
if __name__ == '__main__': build(pathlib.Path(__file__).parent / 'fixtures' / 'nav40.pdf')
