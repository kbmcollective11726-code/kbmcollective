"""Generate docs/KBM-Connect-Client-Demo-Playbook.docx"""
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from pathlib import Path

doc = Document()

for section in doc.sections:
    section.top_margin = Inches(0.85)
    section.bottom_margin = Inches(0.85)
    section.left_margin = Inches(0.95)
    section.right_margin = Inches(0.95)

NAVY = RGBColor(0x1E, 0x3A, 0x5F)
BLUE = RGBColor(0x25, 0x63, 0xEB)
MUTED = RGBColor(0x47, 0x55, 0x69)
SLATE = RGBColor(0x64, 0x74, 0x8B)


def set_run_font(run, size=11, bold=False, color=None):
    run.font.name = "Calibri"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Calibri")
    run.font.size = Pt(size)
    run.bold = bold
    if color:
        run.font.color.rgb = color


def add_heading_styled(text, level=1):
    p = doc.add_heading(text, level=level)
    for run in p.runs:
        run.font.color.rgb = NAVY
        run.font.name = "Calibri"
    return p


def add_para(text, bold=False, size=11, space_after=8, color=None):
    p = doc.add_paragraph()
    run = p.add_run(text)
    set_run_font(run, size=size, bold=bold, color=color)
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(0)
    return p


def add_bullet(text):
    p = doc.add_paragraph(style="List Bullet")
    p.clear()
    run = p.add_run(text)
    set_run_font(run, size=11)
    p.paragraph_format.space_after = Pt(3)
    return p


def add_numbered(text):
    p = doc.add_paragraph(style="List Number")
    p.clear()
    run = p.add_run(text)
    set_run_font(run, size=11)
    p.paragraph_format.space_after = Pt(3)
    return p


def shade_header_row(row):
    for cell in row.cells:
        tcPr = cell._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:fill"), "1E3A5F")
        shd.set(qn("w:val"), "clear")
        tcPr.append(shd)
        for p in cell.paragraphs:
            for run in p.runs:
                run.font.color.rgb = RGBColor(255, 255, 255)
                run.bold = True
                run.font.size = Pt(10)
                run.font.name = "Calibri"


def add_table(headers, rows):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = table.rows[0]
    for i, h in enumerate(headers):
        cell = hdr.cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(h)
        set_run_font(run, size=10, bold=True, color=RGBColor(255, 255, 255))
    shade_header_row(hdr)
    for r_idx, row_data in enumerate(rows):
        row = table.rows[r_idx + 1]
        for c_idx, val in enumerate(row_data):
            cell = row.cells[c_idx]
            cell.text = ""
            run = cell.paragraphs[0].add_run(val)
            set_run_font(run, size=10)
    doc.add_paragraph()
    return table


# Cover
title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
title.paragraph_format.space_before = Pt(60)
set_run_font(title.add_run("KBM Connect"), size=28, bold=True, color=NAVY)

subtitle = doc.add_paragraph()
subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_run_font(
    subtitle.add_run("Client Presentation & Demo Playbook"),
    size=18,
    bold=True,
    color=BLUE,
)

meta = doc.add_paragraph()
meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
meta.paragraph_format.space_before = Pt(18)
set_run_font(
    meta.add_run(
        "Detailed step-by-step guide for sales meetings with potential clients\n"
        "What to discuss, how to discuss it, and the recommended demo flow"
    ),
    size=11,
    color=MUTED,
)

meta2 = doc.add_paragraph()
meta2.alignment = WD_ALIGN_PARAGRAPH.CENTER
meta2.paragraph_format.space_before = Pt(24)
set_run_font(
    meta2.add_run("Internal use — Sales & Client Success\nKBM Collective\nAugust 2026"),
    size=11,
    color=SLATE,
)

doc.add_page_break()

# Overview
add_heading_styled("Document overview", 1)
add_para(
    "This playbook is the standard way KBM Collective presents KBM Connect to potential clients. "
    "Use it for discovery calls, live demos, and follow-up meetings. The goal is not to show every button — "
    "it is to prove how the client can run a smoother, more engaged event."
)
add_para("How to use this document:", bold=True)
add_bullet("Read Sections 1–3 before your first client meeting.")
add_bullet("Use Section 4 as your pre-meeting checklist.")
add_bullet("Follow Section 5 as the live meeting script (45–60 minutes).")
add_bullet("Use Sections 6–8 for feature prioritization, objections, and demo standards.")
add_bullet("Use Sections 9–11 for closing, follow-up, and short-meeting versions.")
add_bullet("Use the Appendix run sheet as a one-page reminder during the meeting.")

# 1
add_heading_styled("1. Purpose of the client meeting", 1)
add_para(
    'You are not "showing an app." You are showing how the client runs a better event with less chaos and clearer ROI.'
)
add_para("What success looks like after the meeting:", bold=True)
add_bullet("The client understands the attendee journey and the organizer control panel.")
add_bullet("You know their must-haves, timeline, and decision process.")
add_bullet("You agree one clear next step (pilot, proposal, or second demo with their content).")

add_heading_styled("1.1 Outcomes you should sell", 2)
add_table(
    ["Outcome", "What it means for the client"],
    [
        [
            "Informed attendees",
            "Agenda, announcements, and reminders live in one place — not PDFs, email chains, or WhatsApp groups.",
        ],
        [
            "Intentional networking",
            "People find each other, message, and connect with purpose.",
        ],
        [
            "Sponsor / vendor value",
            "Booked 1:1 meetings with time and location — measurable meeting activity.",
        ],
        [
            "Day-of control",
            "Organizers update schedule, send announcements, and manage members from one admin console (cadmin).",
        ],
        [
            "Engagement content",
            "Photo feed and optional live wall create energy in the room and content after the event.",
        ],
        [
            "Brand fit",
            "The experience is event-branded, not a generic white-label feel.",
        ],
    ],
)

# 2
add_heading_styled("2. What to discuss (and why)", 1)
add_para(
    "Always discuss business context before features. If you demo first, clients judge buttons instead of outcomes."
)
add_table(
    ["Discussion topic", "Why it matters", "Example questions"],
    [
        [
            "Pain today",
            "Opens the need",
            "What breaks during your event week? Where do attendees get lost?",
        ],
        [
            "Event profile",
            "Shapes the demo",
            "Dates, size, format (summit, association, trade show), single or multi-day?",
        ],
        [
            "Must-haves",
            "Scopes the pitch",
            "Agenda only? Meetings? Registration portals? Live wall?",
        ],
        [
            "Nice-to-haves",
            "Protects focus",
            "Gamification, badges, matchmaking — needed now or later?",
        ],
        [
            "Operations",
            "Shows who owns it",
            "Who creates the event? Who loads attendees? Who runs day-of?",
        ],
        [
            "Success metric",
            "Defines win",
            "What would make you say this was worth it after the event?",
        ],
        [
            "Timeline & decision",
            "Creates next step",
            "When is the next event? Who else must approve?",
        ],
    ],
)

# 3
add_heading_styled("3. How to discuss it", 1)
add_heading_styled("3.1 Tone and language", 2)
add_para("Use organizer language, not engineering language.")
add_bullet("Say: day-of control, sponsor meetings, attendee engagement, event branding.")
add_bullet("Avoid leading with: Expo, Supabase, edge functions, RLS, OTA, runtime versions.")
add_bullet('Mirror their words. If they say "delegates," say "delegates." If they say "sponsors," stay on sponsors.')

add_heading_styled("3.2 Core talk track (memorize)", 2)
add_para(
    '"KBM Connect is the event app and admin console for multi-day conferences. '
    "Attendees get agenda, feed, networking, and meetings in one place. Your team runs the event from cadmin. "
    'We brand it to your event, and we help you stand it up for the first show."'
)

add_heading_styled("3.3 Meeting behaviors that work", 2)
add_bullet("One person drives the phone/laptop; one person presents and watches the room.")
add_bullet('Demo in short blocks; pause and ask "Would your team use this?"')
add_bullet('Use their event type in every example ("for your 3-day leadership summit…").')
add_bullet("Show live product with prepared content — empty screens kill confidence.")
add_bullet("Write down requirements as they speak; read them back before closing.")

add_heading_styled("3.4 Behaviors to avoid", 2)
add_bullet("Feature dumping every menu.")
add_bullet("Apologizing for unfinished edge cases unless they ask.")
add_bullet("Debating price before they care about value.")
add_bullet("Letting the demo wander when Wi-Fi fails — have a hotspot ready.")

# 4
add_heading_styled("4. Pre-meeting preparation checklist", 1)
add_para("Complete this 30–45 minutes before the meeting.")

add_heading_styled("4.1 Logistics", 2)
add_bullet("Confirm meeting time, attendees, and whether they want phone demo, laptop demo, or both.")
add_bullet("Confirm room screen / TV if using live wall.")
add_bullet("Phones charged; backup hotspot tested.")
add_bullet("cadmin URL bookmarked and logged in as demo admin.")
add_bullet("App installed on two devices if possible (admin + attendee).")

add_heading_styled("4.2 Demo event content (must not be empty)", 2)
add_bullet("Demo event created and active, with realistic name/dates.")
add_bullet("Agenda: at least one full day of sessions.")
add_bullet("1–2 announcements ready to show (or send live if appropriate).")
add_bullet("Several feed posts with photos.")
add_bullet("1–2 vendor booths and at least one assigned meeting with time/location.")
add_bullet("Leaderboard points populated if gamification will be shown.")
add_bullet("Event join code / access path ready if clients will try the app themselves.")

add_heading_styled("4.3 Roles", 2)
add_table(
    ["Role", "Responsibility"],
    [
        ["Presenter", "Discovery questions, narrative, objection handling, close"],
        ["Driver", "Phone + cadmin clicks; stays silent unless asked"],
        ["Note taker", "Captures must-haves, timeline, stakeholders, next step"],
    ],
)

# 5
add_heading_styled("5. Recommended meeting flow (45–60 minutes)", 1)
add_para(
    "Follow this sequence unless the client has a rigid agenda. If they only have 20 minutes, use Section 10."
)

add_heading_styled("Step 0 — Open (3 minutes)", 2)
add_bullet("Introductions and roles on your side.")
add_bullet(
    'Set the agenda: "We\'ll learn your event first, then walk the attendee path, then admin control, then agree next steps."'
)
add_bullet("Confirm how much time they have.")

add_heading_styled("Step 1 — Discovery (8–10 minutes)", 2)
add_para("Ask these questions. Do not skip this block.")
add_numbered("What event are you planning next (name, dates, size, format)?")
add_numbered("What do attendees struggle with today?")
add_numbered("Do sponsors or vendors need booked 1:1 meetings?")
add_numbered("Who on your team would manage the app day-of?")
add_numbered("Do you need registration / portals, or mainly the in-event app?")
add_numbered("What would make this a must-have for this event?")
add_numbered("Who else needs to see this before a decision?")
add_para('Then say: "Based on that, I\'ll focus the demo on [X, Y, Z]."')

add_heading_styled("Step 2 — Attendee story (12–15 minutes)", 2)
add_para("Drive the phone through this path. Narrate outcomes, not taps.")
add_table(
    ["Order", "Screen / action", "What to say"],
    [
        [
            "1",
            "Login / join event",
            '"Everyone lands in the right event quickly — no hunting for links."',
        ],
        [
            "2",
            "Home / Info",
            '"This is the branded home base: event info and announcements."',
        ],
        [
            "3",
            "Agenda",
            '"Sessions by day. This replaces the PDF agenda people lose."',
        ],
        [
            "4",
            "Feed + Share photo",
            '"Attendees create energy and content in real time." A few seconds to about 10 seconds on normal Wi-Fi is normal.',
        ],
        [
            "5",
            "Community / profile",
            '"Find people, open profiles, message."',
        ],
        [
            "6",
            "B2B / meetings (if relevant)",
            '"Here\'s my assigned meeting — time and location — so sponsors get real ROI."',
        ],
        [
            "7",
            "Leaderboard (if relevant)",
            '"Optional gamification to drive participation."',
        ],
        [
            "8",
            "Notifications",
            '"Session or meeting starting soon — without staff chasing people."',
        ],
    ],
)
add_para('After each major block, ask: "Does this match how your attendees behave?"')

add_heading_styled("Step 3 — Organizer / admin story (10–12 minutes)", 2)
add_para("Switch to cadmin on a laptop.")
add_numbered("Open event list / the demo event.")
add_numbered("Show branding and event settings.")
add_numbered("Show schedule management (add/edit as a quick proof).")
add_numbered("Show members / roles at a high level.")
add_numbered("Show announcements (and push if appropriate for the room).")
add_numbered("Show vendor booths + meeting assignment if they care about sponsors.")
add_numbered("Show portal / matchmaking toggles only if discovery said they need them.")
add_para(
    'Close this block with: "Your ops team owns the event without waiting on developers for every change."'
)

add_heading_styled("Step 4 — Optional wow moments (3–5 minutes)", 2)
add_bullet("Live wall on a big screen (feed energy in the room).")
add_bullet("Platform All Events view for multi-event operators / agencies.")
add_bullet("Registration or vendor/delegate portal flow if that was a must-have.")
add_para("Skip this entire step if time is tight or discovery did not call for it.")

add_heading_styled("Step 5 — Fit check (5 minutes)", 2)
add_numbered("What must be included for your next event?")
add_numbered("What can wait until event #2?")
add_numbered("Who else needs to see this (ops, sponsorship, IT/security)?")
add_numbered("What is your decision timeline?")
add_para("Read back a short summary of what you heard.")

add_heading_styled("Step 6 — Close (5 minutes)", 2)
add_para("Propose exactly one next step:")
add_bullet("Pilot on a named upcoming event, or")
add_bullet("Scoped written proposal + timeline, or")
add_bullet("Follow-up demo with their agenda/sponsors loaded into a sandbox event.")
add_para("Confirm owner and date for that next step before you leave the call.")

# 6
add_heading_styled("6. Feature map — what to show vs skip", 1)
add_table(
    [
        "Show early (almost every demo)",
        "Show if they ask / discovery requires it",
        "Leave for later / separate call",
    ],
    [
        ["Agenda", "Live wall", "Deep security architecture"],
        ["Announcements / push", "Matchmaking / portals", "Internal QA tools"],
        ["Feed photo share", "Badges / session check-in", "Edge-case bug lists"],
        ["B2B meetings", "Multi-event platform admin", "Custom one-off builds"],
        ["cadmin day-of control", "Leaderboard / points", "Pricing before value"],
        ["Event branding", "Registration flows", "Tech stack deep dive"],
    ],
)

# 7
add_heading_styled("7. Objection handling", 1)
add_table(
    ["Objection", "Response direction"],
    [
        [
            "We already have a PDF / website.",
            "Those do not push session reminders, assigned meetings, or live engagement in one attendee workflow.",
        ],
        [
            "Will people actually use it?",
            "Usage rises when agenda + meetings + announcements live in the app. Show that exact path.",
        ],
        [
            "Can it look like our brand?",
            "Yes — event branding, banners, and event-specific content.",
        ],
        [
            "Who runs it day-of?",
            "Their event admin in cadmin. KBM can support setup for the first event.",
        ],
        [
            "What about security / data?",
            "Keep high-level: authenticated access, role-based admin, event-scoped data. Offer a separate IT/security call for enterprise buyers.",
        ],
        [
            "We need custom features.",
            "Capture as Phase 2. Confirm what is required for event #1 vs later.",
        ],
        [
            "How long to stand up?",
            "Depends on content readiness (agenda, members, sponsors). Offer a realistic setup plan in the proposal, not a guess on the call.",
        ],
    ],
)

# 8
add_heading_styled("8. Demo environment standards", 1)
add_bullet("Never demo on an empty event.")
add_bullet("Prefer production-like builds (installed app), not Expo Go, for client confidence.")
add_bullet(
    "If photo share is shown, set expectation: a few seconds to about 10 seconds on normal Wi-Fi is normal; slower on weak cell."
)
add_bullet(
    "If platform-admin login is shown on mobile, expect All Events first, then pick an event."
)
add_bullet("Have a backup attendee account already joined to the demo event.")
add_bullet(
    "Do not display real client PII or production attendee emails during a sales demo unless the meeting is with that client’s own data and they requested it."
)

# 9
add_heading_styled("9. After the meeting — same-day follow-up", 1)
add_para("Send a short email the same day:")
add_numbered("Thank you.")
add_numbered("3–5 bullets of what they said they need.")
add_numbered("What you showed that maps to those needs.")
add_numbered("Proposed next step + suggested date.")
add_numbered("Optional one-page capability summary (no jargon).")
add_para("Internal notes to capture immediately:", bold=True)
add_bullet("Event name / dates / estimated attendees")
add_bullet("Must-haves vs nice-to-haves")
add_bullet("Stakeholders and decision date")
add_bullet("Risks / blockers (IT, budget cycle, content ownership)")
add_bullet("Promised next step and owner")

# 10
add_heading_styled("10. Express demo (20 minutes)", 1)
add_para("Use when the client only has a short slot.")
add_numbered("Discovery (5 min) — event, pain, must-haves, decision timing.")
add_numbered("Attendee path (8 min) — Home → Agenda → Feed → Meeting.")
add_numbered("Admin proof (4 min) — schedule + announcement in cadmin.")
add_numbered("Ask + next step (3 min) — one clear follow-up.")

# 11
add_heading_styled("11. Discovery call only (no live demo)", 1)
add_para("Sometimes the first meeting is discovery only. Still use Sections 2 and 3, then:")
add_bullet("Confirm whether a live demo is needed and with whom.")
add_bullet("Ask for sample agenda / sponsor list to load before the demo.")
add_bullet("Schedule the demo within a few days while interest is warm.")

# Appendix
doc.add_page_break()
add_heading_styled("Appendix A — One-page demo run sheet", 1)
add_para("Print or keep this page open during the meeting.", bold=True)
add_para("OPEN → DISCOVERY → ATTENDEE PATH → ADMIN (cadmin) → FIT CHECK → ONE NEXT STEP")
add_para("Discovery checklist:", bold=True)
add_bullet("Event / dates / size / format")
add_bullet("Pain today")
add_bullet("Sponsors need meetings? Y/N")
add_bullet("Who runs day-of?")
add_bullet("Portals/registration needed? Y/N")
add_bullet("Must-haves")
add_bullet("Decision makers + timeline")
add_para("Attendee path:", bold=True)
add_bullet("Login/join → Home → Agenda → Feed → Community → Meetings → Rank → Notifications")
add_para("Admin path:", bold=True)
add_bullet("Event settings → Schedule → Members → Announcements → Booths/meetings → (Portals if needed)")
add_para("Close line:", bold=True)
add_para(
    '"Based on what you shared, the best next step is [pilot / proposal / loaded sandbox demo] on [date]. Does that work?"'
)

add_heading_styled("Appendix B — Sample talk tracks", 1)
add_para("Opening:", bold=True)
add_para(
    '"Thanks for the time. We\'ll spend a few minutes on your event goals, then I\'ll show the attendee experience '
    'and how your team controls the event from the admin side. We\'ll end with a clear next step."'
)
add_para("Transition into demo:", bold=True)
add_para('"You mentioned [pain]. Watch how that shows up for an attendee in the first minute."')
add_para("Transition to admin:", bold=True)
add_para(
    '"That was the attendee side. Here\'s how your team changes agenda and messaging without waiting on a developer."'
)
add_para("Closing:", bold=True)
add_para(
    '"You need [must-haves] by [date]. We can [next step]. I\'ll send a short recap today and propose times for [follow-up]."'
)

add_heading_styled("Appendix C — Do / Don’t quick list", 1)
add_table(
    ["Do", "Don’t"],
    [
        ["Lead with their event outcomes", "Lead with tech stack"],
        ["Demo with prepared content", "Show empty tabs"],
        ["Ask after each block", "Monologue for 20 minutes"],
        ["Capture must-haves in writing", "Rely on memory"],
        ['Agree one next step', 'End with "let us know"'],
        ["Offer IT/security as a separate deep dive", "Over-promise custom work on the call"],
    ],
)

add_heading_styled("Appendix D — Document control", 1)
add_table(
    ["Field", "Value"],
    [
        ["Document title", "KBM Connect — Client Presentation & Demo Playbook"],
        ["Audience", "Internal sales, founders, client success"],
        ["Product", "KBM Connect (mobile app + cadmin + optional live wall/portals)"],
        ["Version", "1.0 — August 2026"],
        ["Owner", "KBM Collective"],
    ],
)

out = Path(__file__).resolve().parents[1] / "docs" / "KBM-Connect-Client-Demo-Playbook.docx"
out.parent.mkdir(parents=True, exist_ok=True)
doc.save(out)
print(f"Wrote {out}")
