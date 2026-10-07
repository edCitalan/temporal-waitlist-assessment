"""Rebuild Lena's standalone PDF slides: python scripts/build-slides.py (requires reportlab)."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/presentation/juniper-salon-prototype.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)
W, H = 960, 540
INK, GREEN, MUTED = "#273b34", "#285c4a", "#58675e"
PAPER, CREAM, CORAL = "#fffefa", "#f6f3ed", "#984b36"
c = canvas.Canvas(str(OUT), pagesize=(W, H))
c.setTitle("Juniper Salon | Earlier appointments, clearer outcomes")
c.setAuthor("Edward Citalan")

def text(x, top, content, size=17, color=INK, width=860, font="Helvetica", leading=None):
    style = ParagraphStyle("body", fontName=font, fontSize=size, leading=leading or size*1.3, textColor=HexColor(color))
    p = Paragraph(content, style)
    _, height = p.wrap(width, H)
    p.drawOn(c, x, H-top-height)
    return height

def box(x, top, w, h, fill=PAPER):
    c.setFillColor(HexColor(fill))
    c.setStrokeColor(HexColor("#e2ddd2"))
    c.roundRect(x, H-top-h, w, h, 12, fill=1, stroke=1)

def page(n, eyebrow, title, subtitle):
    c.setFillColor(HexColor(CREAM)); c.rect(0, 0, W, H, fill=1, stroke=0)
    text(44, 23, "juniper / SALON", 12, GREEN, font="Helvetica-Bold")
    text(710, 23, "LOCAL PROTOTYPE | SIMULATED", 10, CORAL, 220, "Helvetica-Bold")
    text(44, 73, eyebrow.upper(), 11, MUTED, font="Helvetica-Bold")
    text(44, 97, title, 37, GREEN, font="Times-Roman")
    text(44, 151, subtitle, 17, MUTED)
    c.setStrokeColor(HexColor("#dfd9cc")); c.line(44, 43, 916, 43)
    text(44, 509, "Prepared for Lena and Carla | October 7, 2026 | No real texts sent", 9, MUTED)
    text(880, 509, f"{n} / 4", 9, MUTED, 40)

page(1, "The problem Lena described", "Fill the gap. Keep one clear promise.",
     "Last-minute cancellations create empty appointments and repeated checking.")
for x, label, body in [
    (44, "Today", "Staff check Square, scan a Google Sheet, text a likely match, and wait. The stopping point is unclear."),
    (342, "The failure to avoid", "Two clients once said yes to the same group text. Different staff replied, and a client arrived expecting the slot."),
    (640, "Lena's goal", "Fewer empty slots, less chasing, and one visible appointment holder. Square remains the real calendar."),
]:
    box(x, 218, 276, 194)
    text(x+19, 238, label, 20, GREEN, 238, "Helvetica-Bold")
    text(x+19, 278, body, 16, INK, 238)
box(44, 431, 872, 50, "#eaf2ed")
text(62, 445, "Agreed approach: oldest eligible request first, one client at a time for each opening.", 17, GREEN, 835)
c.showPage()

page(2, "How the prototype behaves", "Offer. Wait. Resolve. Keep staff informed.",
     "Staff manage openings. Clients use a personal offer page with exact details and a deadline.")
steps = [
    ("1  Add an opening", "Staff enter the appointment details, reply window (default 15 minutes), and any practical cutoff."),
    ("2  Find a match", "Match service, availability and stylist. Exclude opt-outs. Offer the oldest eligible request first."),
    ("3  Client responds", "Clients accept, decline or ask a question on their offer page. Decline or the reply deadline moves to the next client."),
    ("4  Confirm one holder", "A clear, valid acceptance reserves the slot here. Staff update Square manually, then mark the checklist done."),
]
for i, (title, body) in enumerate(steps):
    x = 44+i*223
    box(x, 218, 203, 207)
    text(x+16, 236, title, 17, GREEN, 172, "Helvetica-Bold")
    text(x+16, 280, body, 15, INK, 172)
text(44, 447, "Open the detail page for the holder and message timeline. Fast-forward 15 minutes to demonstrate no reply. Temporal preserves the clock and deadlines after restart.", 16, MUTED, 866)
c.showPage()

page(3, "Verification and prototype boundaries", "Checked behavior. Clearly stated limits.",
     "37 automated tests passed, plus 17 browser checks across staff and client pages.")
box(44, 215, 424, 264)
text(63, 232, "What passed", 21, GREEN, 385, "Helvetica-Bold")
text(63, 272, "<b>Staff:</b> protected access, message history and a manual Square checklist.<br/><br/><b>Clients:</b> personal links show exact details, response choices and the result.<br/><br/><b>Reliability:</b> duplicate protection, matching, timeouts, cancellation races, one holder and worker restart.", 16, INK, 382)
box(490, 215, 426, 264, "#fff5ef")
text(509, 232, "What is simulated or excluded", 21, CORAL, 385, "Helvetica-Bold")
text(509, 272, "<b>No real SMS.</b> Open the client's personal link from the staff demo. The client page is clearly simulated.<br/><br/><b>No Square connection.</b> Staff update it manually.<br/><br/><b>Sample waitlist.</b> Live intake and opt-out management remain future work. Staff passwords are local.", 16, INK, 381)
c.showPage()

page(4, "A practical next step", "Walk through a real cancellation together.",
     "Lena and Carla can review the local prototype before any real-client pilot.")
box(44, 216, 530, 263)
text(64, 234, "A focused staff review", 21, GREEN, 490, "Helvetica-Bold")
text(64, 277, "<b>1.</b> Pick an opening and explain who should get it first.<br/><br/><b>2.</b> Try a question, decline, acceptance and cancellation; check the visible result and Square handoff.<br/><br/><b>3.</b> Agree on practical cutoff guidance and what staff need before using it with real clients.", 17, INK, 486)
box(594, 216, 322, 263)
text(614, 234, "Then prepare a small pilot", 20, GREEN, 280, "Helvetica-Bold")
text(614, 276, "Add live waitlist consent/opt-out handling and SMS with safe retries. Review staff account support before a pilot.<br/><br/>Measure openings filled, staff checking time and conflicting claims against today's process.", 16, INK, 280)
c.showPage()
c.save()
print(OUT)
