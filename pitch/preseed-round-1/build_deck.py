#!/usr/bin/env python3
"""Campfire pre-seed round one deck.

Spine is the pitch-deck cheat code: why this, why now, why you, then the
evidence you can execute (/product /selling /scaling), the money, what exists
at the next round, and the unfair advantage.

The deck is a leave-behind for a conversation. One belief per slide.
Facts are limited to what the product site and this repository actually record.
The raise figure is a working ask; the repo does not contain a term sheet.
"""

from __future__ import annotations

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
OUT = ROOT / "Campfire-Preseed-Round-1.pptx"

# Brand, from boringinfra.company/campfire
PAPER = "F7F3EA"
INK = "171717"
SMOKE = "595752"
ASH = "A7A39B"
EMBER = "FC6142"
EMBER_DARK = "D9442E"
FIRE = "FFD166"
CREAM = "F7F3EA"
PANEL = "171717"
RULE = "E4DDD0"

W = Inches(13.333333)
H = Inches(7.5)

SERIF = "Instrument Serif"
SANS = "DM Sans"
SANS_MED = "DM Sans Medium"
MONO = "IBM Plex Mono"
MONO_MED = "IBM Plex Mono Medium"


def rgb(value: str) -> RGBColor:
    return RGBColor.from_string(value)


def set_bg(slide, color: str) -> None:
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = rgb(color)


def rect(slide, x, y, w, h, color: str):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shape.fill.solid()
    shape.fill.fore_color.rgb = rgb(color)
    shape.line.fill.background()
    style = shape._element.find(qn("p:style"))
    if style is not None:
        shape._element.remove(style)
    return shape


def _apply_run(run, text, font, size, color, bold, italic, spacing):
    run.text = text
    run.font.name = font
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = rgb(color)
    r_pr = run._r.get_or_add_rPr()
    for tag in ("latin", "cs", "ea"):
        el = r_pr.find(qn(f"a:{tag}"))
        if el is None:
            el = r_pr.makeelement(qn(f"a:{tag}"), {})
            r_pr.append(el)
        el.set("typeface", font)
    if spacing is not None:
        r_pr.set("spc", str(int(spacing)))


def textbox(slide, x, y, w, h, paragraphs, align="left", anchor="top"):
    """paragraphs: list of dicts with text/runs plus optional size, font, color, bold, italic, spacing, align, before, after, line."""
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.auto_size = None
    tf.margin_left = Emu(0)
    tf.margin_right = Emu(0)
    tf.margin_top = Emu(0)
    tf.margin_bottom = Emu(0)
    anchor_map = {"top": "t", "middle": "ctr", "bottom": "b"}
    tf._txBody.bodyPr.set("anchor", anchor_map[anchor])
    align_map = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}

    for i, spec in enumerate(paragraphs):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align_map[spec.get("align", align)]
        p.space_before = Pt(spec.get("before", 0))
        p.space_after = Pt(spec.get("after", 0))
        if "line" in spec:
            p.line_spacing = spec["line"]
        runs = spec.get("runs")
        if runs is None:
            runs = [spec]
        for run_spec in runs:
            run = p.add_run()
            _apply_run(
                run,
                run_spec.get("text", ""),
                run_spec.get("font", spec.get("font", SANS)),
                run_spec.get("size", spec.get("size", 16)),
                run_spec.get("color", spec.get("color", INK)),
                run_spec.get("bold", spec.get("bold", False)),
                run_spec.get("italic", spec.get("italic", False)),
                run_spec.get("spacing", spec.get("spacing")),
            )
    return box


def kicker(slide, index: str, label: str, color=EMBER, y=0.42):
    textbox(
        slide,
        0.72,
        y,
        8,
        0.32,
        [{"text": f"{index}   /   {label}", "font": MONO_MED, "size": 12, "color": color, "spacing": 140}],
    )


def footer(slide, page: str, dark=False):
    mute = "8A8680" if dark else ASH
    textbox(
        slide,
        0.72,
        7.08,
        6,
        0.28,
        [{"text": "campfire", "font": MONO, "size": 11, "color": mute, "spacing": 40}],
    )
    textbox(
        slide,
        7.4,
        7.08,
        5.2,
        0.28,
        [{"text": f"boringinfra.company/campfire      {page}", "font": MONO, "size": 11, "color": mute, "spacing": 40, "align": "right"}],
        align="right",
    )


def notes(slide, body: str) -> None:
    frame = slide.notes_slide.notes_text_frame
    frame.text = body.strip()


def picture(slide, path: Path, x, y, w, h):
    return slide.shapes.add_picture(str(path), Inches(x), Inches(y), Inches(w), Inches(h))


def build() -> Presentation:
    prs = Presentation()
    prs.slide_width = W
    prs.slide_height = H
    prs.core_properties.title = "Campfire Pre-seed, Round One"
    prs.core_properties.author = "Boring Infra Co."
    prs.core_properties.subject = "Pre-seed pitch. Ask: $500k."
    prs.core_properties.category = "Pitch"
    blank = prs.slide_layouts[6]

    cover(prs, blank)
    why_this(prs, blank)
    why_now(prs, blank)
    why_you(prs, blank)
    product(prs, blank)
    traction(prs, blank)
    selling(prs, blank)
    scaling(prs, blank)
    money(prs, blank)
    next_round(prs, blank)
    advantage(prs, blank)
    return prs


def cover(prs, blank):
    slide = prs.slides.add_slide(blank)
    set_bg(slide, PAPER)
    picture(slide, ASSETS / "campfire-icon.png", 0.72, 0.40, 0.52, 0.58)
    picture(slide, ASSETS / "wordmark-ink.png", 1.38, 0.50, 1.72, 0.44)
    textbox(
        slide,
        7.3,
        0.52,
        5.3,
        0.32,
        [{"text": "PRE-SEED   ·   ROUND 1", "font": MONO_MED, "size": 13, "color": EMBER, "spacing": 160, "align": "right"}],
        align="right",
    )
    textbox(
        slide,
        0.72,
        1.85,
        12.0,
        2.35,
        [
            {
                "text": "Give your agents",
                "font": SERIF,
                "size": 60,
                "color": INK,
                "italic": True,
                "line": 0.92,
            },
            {
                "runs": [
                    {"text": "a place to work ", "font": SERIF, "size": 60, "color": INK, "italic": True},
                    {"text": "together.", "font": SERIF, "size": 60, "color": EMBER, "italic": True},
                ],
                "line": 0.92,
                "before": 0,
            },
        ],
    )
    textbox(
        slide,
        0.74,
        4.45,
        9.5,
        0.85,
        [
            {
                "text": "A shared workspace for humans and the agents they already use.",
                "font": SANS,
                "size": 20,
                "color": SMOKE,
                "line": 1.15,
            }
        ],
    )
    textbox(
        slide,
        0.74,
        5.40,
        8,
        0.62,
        [
            {"text": "boringinfra.company/campfire", "font": MONO, "size": 14, "color": INK},
            {"text": "github.com/BoringInfraCo/Campfire", "font": MONO, "size": 14, "color": SMOKE, "before": 4},
        ],
    )
    rect(slide, 0, 6.22, 13.333, 1.28, INK)
    textbox(
        slide,
        0.72,
        6.40,
        4.2,
        0.95,
        [
            {"text": "$500k", "font": SERIF, "size": 36, "color": EMBER, "italic": True},
            {"text": "pre-seed  ·  round one", "font": MONO, "size": 12, "color": "C8C2B8", "spacing": 60, "before": 2},
        ],
    )
    textbox(
        slide,
        6.3,
        6.48,
        6.3,
        0.85,
        [
            {"text": "One founder. Eighteen months. No hire.", "font": SANS, "size": 18, "color": CREAM, "align": "right"},
            {"text": "A hosted workspace a team pays for.", "font": SERIF, "size": 18, "color": FIRE, "italic": True, "align": "right", "before": 2},
        ],
        align="right",
    )
    notes(
        slide,
        """
OPEN: I brought a deck. I would rather have the conversation. Jump in whenever.

LAND: We are raising five hundred thousand dollars. One founder, eighteen months, no hire. The build is a hosted team workspace, and that product is paid.

IF THEY ASK WHAT IT IS: Campfire is the shared workspace. Codex stays Codex. Claude Code stays Claude Code. We keep the goal, the finding, and the decision after the terminal closes. The local tool stays open source. The cloud team offering is the business, and it is closed.

If they have read the site: today the public product is local-first, and there is no hosted team journal yet. This round is the decision to build that. Do not describe it as already live.
        """,
    )


def why_this(prs, blank):
    slide = prs.slides.add_slide(blank)
    set_bg(slide, PAPER)
    kicker(slide, "02", "WHY THIS")
    textbox(
        slide,
        0.72,
        0.95,
        6.3,
        2.15,
        [
            {"text": "Close the terminal.", "font": SERIF, "size": 44, "italic": True, "color": INK, "line": 0.95},
            {"text": "Keep the work.", "font": SERIF, "size": 44, "italic": True, "color": EMBER, "line": 0.95},
        ],
    )
    textbox(
        slide,
        0.72,
        3.30,
        6.05,
        2.15,
        [
            {
                "text": "The goal is in one session. The decision is in another. The next agent starts from an empty prompt.",
                "font": SANS,
                "size": 20,
                "color": INK,
                "line": 1.2,
            },
            {
                "text": "Five people can each have an agent. None of those agents know what the others did.",
                "font": SANS,
                "size": 20,
                "color": SMOKE,
                "line": 1.2,
                "before": 14,
            },
        ],
    )
    textbox(
        slide,
        0.72,
        5.85,
        6.1,
        0.95,
        [
            {
                "text": "The transcript stays private.\nThe decision stays with the team.",
                "font": SERIF,
                "size": 20,
                "italic": True,
                "color": INK,
                "line": 1.05,
            }
        ],
    )

    rect(slide, 7.25, 0.95, 5.35, 5.55, INK)
    textbox(
        slide,
        7.58,
        1.18,
        4.7,
        0.3,
        [{"text": "WITHOUT", "font": MONO_MED, "size": 12, "color": EMBER, "spacing": 180}],
    )
    rows = [
        ("session 1", "gone"),
        ("session 2", "gone"),
        ("a decision", "somewhere else"),
    ]
    y = 1.62
    for label, status in rows:
        textbox(slide, 7.58, y, 2.3, 0.36, [{"text": label, "font": MONO, "size": 15, "color": "E7E1D6"}])
        textbox(
            slide,
            9.7,
            y,
            2.6,
            0.36,
            [{"text": status, "font": MONO, "size": 15, "color": ASH, "align": "right"}],
            align="right",
        )
        y += 0.46
    rect(slide, 7.58, 3.15, 1.15, 0.035, EMBER)
    textbox(
        slide,
        7.58,
        3.45,
        4.7,
        0.3,
        [{"text": "WITH CAMPFIRE", "font": MONO_MED, "size": 12, "color": FIRE, "spacing": 180}],
    )
    rows = [
        ("goal", "still here"),
        ("finding", "still here"),
        ("decision", "still here"),
    ]
    y = 3.92
    for label, status in rows:
        textbox(slide, 7.58, y, 2.3, 0.36, [{"text": label, "font": MONO, "size": 15, "color": CREAM}])
        textbox(
            slide,
            9.7,
            y,
            2.6,
            0.36,
            [{"text": status, "font": MONO, "size": 15, "color": EMBER, "align": "right"}],
            align="right",
        )
        y += 0.48

    footer(slide, "02  /  11")
    notes(
        slide,
        """
OPEN: Close the terminal. Right now the work goes with it.

Point at the card. Three sessions, nothing in common. A goal in one, a decision in a chat, the next agent empty.

LAND: The transcript stays on their machine. The decision stays with the team.

We do not sync chat. Shared work state is the product. Access to a finding is not access to the private conversation that produced it.
        """,
    )


def why_now(prs, blank):
    slide = prs.slides.add_slide(blank)
    set_bg(slide, INK)
    kicker(slide, "03", "WHY NOW", color=EMBER)
    textbox(
        slide,
        0.72,
        0.95,
        12,
        1.9,
        [
            {"text": "The agents arrived.", "font": SERIF, "size": 48, "italic": True, "color": CREAM, "line": 0.95},
            {"text": "The team did not.", "font": SERIF, "size": 48, "italic": True, "color": EMBER, "line": 0.95},
        ],
    )
    beats = [
        ("01", "Coding agents are already in the repo."),
        ("02", "They still cannot see what the others decided."),
        ("03", "Every new harness makes that gap wider."),
    ]
    x = 0.72
    for num, line in beats:
        textbox(slide, x, 3.35, 3.7, 0.4, [{"text": num, "font": SERIF, "size": 22, "italic": True, "color": EMBER}])
        textbox(
            slide,
            x,
            3.85,
            3.75,
            1.45,
            [{"text": line, "font": SANS, "size": 20, "color": CREAM, "line": 1.15}],
        )
        x += 4.1
    textbox(
        slide,
        0.72,
        5.75,
        11.5,
        0.9,
        [
            {
                "text": "The labs will keep shipping agents. The place those agents meet is still empty.",
                "font": SERIF,
                "size": 22,
                "italic": True,
                "color": FIRE,
            }
        ],
    )
    footer(slide, "03  /  11", dark=True)
    notes(
        slide,
        """
OPEN: This showed up in the repository this year. The team structure did not.

No market-size slide. We do not have a sourced TAM, and I will not invent one. The timing is structural. Codex, Claude Code, OpenCode, Cursor: a team can adopt a second harness this quarter. The work those agents produce still dies in a private session.

LAND: The labs will keep shipping agents. The place those agents meet is still empty, and every team that adds a second harness feels it now.
        """,
    )


def why_you(prs, blank):
    slide = prs.slides.add_slide(blank)
    set_bg(slide, PAPER)
    kicker(slide, "04", "WHY YOU")
    textbox(
        slide,
        0.72,
        0.88,
        11.5,
        1.05,
        [
            {
                "text": "Built by someone who lives in the workflow.",
                "font": SERIF,
                "size": 40,
                "italic": True,
                "color": INK,
                "line": 0.98,
            }
        ],
    )
    textbox(
        slide,
        0.74,
        1.95,
        10,
        0.42,
        [
            {
                "runs": [
                    {"text": "Sergio Rovira, ", "font": SERIF, "size": 26, "italic": True, "color": INK},
                    {"text": "Founder, Boring Infra Co.", "font": SERIF, "size": 22, "italic": True, "color": EMBER},
                ],
            }
        ],
    )
    rect(slide, 0.74, 2.48, 2.4, 0.03, EMBER)
    textbox(
        slide,
        0.72,
        2.75,
        6.15,
        3.35,
        [
            {
                "text": "A design engineer with 10+ years building software and developer tools.",
                "font": SANS,
                "size": 18,
                "color": INK,
                "line": 1.22,
            },
            {
                "text": "Campfire started from a problem encountered firsthand: working across multiple coding agents without a shared understanding of the work.",
                "font": SANS,
                "size": 18,
                "color": SMOKE,
                "line": 1.22,
                "before": 14,
            },
        ],
    )
    rect(slide, 7.15, 2.65, 5.45, 3.55, INK)
    textbox(
        slide,
        7.45,
        2.88,
        4.9,
        0.3,
        [{"text": "SHIPPING", "font": MONO_MED, "size": 12, "color": EMBER, "spacing": 160}],
    )
    textbox(
        slide,
        7.45,
        3.35,
        4.85,
        2.55,
        [
            {
                "text": "From v0.1 to v1.12 in just a month.",
                "font": SANS_MED,
                "size": 19,
                "color": CREAM,
                "line": 1.2,
            },
            {
                "text": "Open source, installable, and shipping.",
                "font": SANS,
                "size": 17,
                "color": "D8D2C8",
                "before": 10,
            },
            {
                "text": "Multiple infrastructure products designed and built before Campfire.",
                "font": SANS,
                "size": 15,
                "color": ASH,
                "line": 1.2,
                "before": 14,
            },
        ],
    )
    textbox(
        slide,
        0.72,
        6.18,
        11.8,
        0.55,
        [
            {
                "text": "One founder. No hire. This round builds the hosted team product.",
                "font": SERIF,
                "size": 20,
                "italic": True,
                "color": INK,
            }
        ],
    )
    footer(slide, "04  /  11")
    notes(
        slide,
        """
OPEN: I did not start with a category. I started with the workflow.

LAND: Design engineer, ten-plus years on software and developer tools. Campfire is the thing I needed while running multiple coding agents on the same work. v0.1 to v1.12 in just a month. I ship.

If they ask about Boring Infra: Harnie, Meno, Pico, Root, Sandman, Combie share the same taste. This round is Campfire only.

Do not put field-trace cancellation or Viewer comprehension on this slide. Those belong in technical diligence. The repo documents both. Offer to walk them there if they want the unvarnished engineering record.

If they ask for employers or a longer résumé, answer from your life. The slide is the positioning, not the CV.
        """,
    )


def product(prs, blank):
    slide = prs.slides.add_slide(blank)
    set_bg(slide, PAPER)
    kicker(slide, "05", "PRODUCT")
    textbox(
        slide,
        0.72,
        0.82,
        5.8,
        1.75,
        [
            {"text": "One workspace.", "font": SERIF, "size": 36, "italic": True, "color": INK, "line": 0.95},
            {"text": "Everyone sees the work.", "font": SERIF, "size": 36, "italic": True, "color": EMBER, "line": 0.95},
        ],
    )
    textbox(
        slide,
        0.74,
        2.55,
        5.55,
        1.05,
        [
            {
                "text": "Two humans. Multiple agents. One shared goal, findings, decisions, and history.",
                "font": SANS,
                "size": 17,
                "color": INK,
                "line": 1.2,
            }
        ],
    )
    participants = [
        ("Sergio", "human"),
        ("Codex", "agent"),
        ("Alice", "human"),
        ("OpenCode", "agent"),
    ]
    y = 3.85
    for name, kind in participants:
        textbox(slide, 0.74, y, 1.4, 0.28, [{"text": name, "font": SANS_MED, "size": 14, "color": INK}])
        textbox(slide, 2.1, y, 1.2, 0.28, [{"text": kind, "font": MONO, "size": 11, "color": SMOKE}])
        y += 0.30
    rect(slide, 6.55, 1.05, 6.05, 5.35, INK)
    screenshot = ASSETS / "viewer-screenshot.png"
    if screenshot.is_file():
        picture(slide, screenshot, 6.62, 1.12, 5.91, 5.21)
    textbox(
        slide,
        6.62,
        6.42,
        5.95,
        0.28,
        [
            {
                "text": "Campfire Viewer, billing-flow workspace",
                "font": MONO,
                "size": 10,
                "color": ASH,
                "align": "center",
                "spacing": 30,
            }
        ],
        align="center",
    )
    footer(slide, "05  /  11")
    notes(
        slide,
        """
OPEN: Stop talking and show the room.

Point at the screenshot. Sergio and Alice are humans. Codex and OpenCode are agents on the same workspace. The goal is at the top. A finding from Codex. A decision from Sergio. The workstream shows who did what. Nobody pasted a transcript.

LAND: This is the N:M picture. Not one human and one agent. A team shape. The numbers are on the next slide.

The screenshot is a seeded demo workspace that matches the site story. It is real Campfire Viewer UI against real API data, not a mockup. Regenerate with `npx tsx pitch/preseed-round-1/capture_viewer.ts` after Viewer changes.

Diligence only: Viewer comprehension is unverified on v1.12. Codex/OpenCode handoff is validated in repo; Claude Code and Cursor are not. Field trace cancelled. Do not lead with those on this slide.

If they want to install: boringinfra.company/campfire/install.sh
        """,
    )


def traction(prs, blank):
    slide = prs.slides.add_slide(blank)
    set_bg(slide, PAPER)
    kicker(slide, "06", "EARLY TRACTION")
    textbox(
        slide,
        0.72,
        0.88,
        12,
        1.45,
        [
            {"text": "Developers are showing up.", "font": SERIF, "size": 36, "italic": True, "color": INK, "line": 0.95},
            {"text": "And coming back.", "font": SERIF, "size": 36, "italic": True, "color": EMBER, "line": 0.95},
        ],
    )
    metrics = [
        ("851", "Activated installations"),
        ("478", "Active installations this week"),
        ("536", "Ever-active installations"),
        ("218", "Peak daily active installations"),
    ]
    positions = [(0.72, 2.70), (6.90, 2.70), (0.72, 4.35), (6.90, 4.35)]
    for (amount, label), (x, y) in zip(metrics, positions):
        textbox(slide, x, y, 5.4, 0.7, [{"text": amount, "font": SERIF, "size": 44, "italic": True, "color": EMBER}])
        textbox(slide, x, y + 0.72, 5.4, 0.4, [{"text": label, "font": SANS, "size": 18, "color": INK}])
    textbox(
        slide,
        0.72,
        5.85,
        12,
        0.4,
        [
            {
                "text": "Open source. No paid acquisition reported. Building toward Campfire Cloud.",
                "font": SERIF,
                "size": 18,
                "italic": True,
                "color": INK,
            }
        ],
    )
    textbox(
        slide,
        0.72,
        6.35,
        12,
        0.45,
        [
            {
                "text": "Internal installation telemetry, October 10, 2026. Week beginning October 4.",
                "font": MONO,
                "size": 12,
                "color": SMOKE,
            },
            {
                "text": "Installations, not developers or teams.",
                "font": MONO,
                "size": 12,
                "color": SMOKE,
                "before": 2,
            },
        ],
    )
    footer(slide, "06  /  11")
    notes(
        slide,
        """
OPEN: Developers are showing up. And some of them are coming back.

Read the four numbers. 851 installations have done something meaningful at least once. 536 have been active after that. 478 were active in the week beginning October 4. The busiest day so far was 218.

These are anonymous installation ids, a random id stored with one Campfire install. They are not unique developers and not teams. One person can have more than one installation.

Activated means the first real use: a successful onboard, a successful join, or the first successful read of a workspace. It is once per installation. It is not a startup or a heartbeat.

Active means a later successful read of a workspace, at most once per installation per UTC day. A polling Viewer or an agent loop cannot inflate it.

The jump from 119 to 478 weekly active happened inside this same calendar week. It is not week-over-week growth. Do not say activity quadrupled. Wait for two complete weeks before any week-over-week claim. Leave the percentage deltas off the slide.

LAND: We shipped a real product. Installations are activating it, and some are using it again. That is early evidence. It is not product-market fit.

No paid acquisition. Open source. The business we are building is still Campfire Cloud.
        """,
    )


def selling(prs, blank):
    slide = prs.slides.add_slide(blank)
    set_bg(slide, PAPER)
    kicker(slide, "07", "SELLING")
    textbox(
        slide,
        0.72,
        0.88,
        12,
        1.55,
        [
            {"text": "Open source gets us into the workflow.", "font": SERIF, "size": 32, "italic": True, "color": INK, "line": 0.98},
            {"text": "Cloud brings teams together.", "font": SERIF, "size": 32, "italic": True, "color": EMBER, "line": 0.98},
        ],
    )
    steps = [
        ("01", "Install locally", "A developer puts Campfire on their machine."),
        ("02", "Coordinate agents", "Goals, findings, and decisions start to live in one place."),
        ("03", "Invite teammates", "A second person needs the same record."),
        ("04", "Hosted workspace", "The team pays for the shared cloud. That product is closed."),
    ]
    y = 2.62
    for num, title, body in steps:
        textbox(slide, 0.72, y, 0.7, 0.36, [{"text": num, "font": SERIF, "size": 20, "italic": True, "color": EMBER}])
        textbox(slide, 1.55, y - 0.02, 10.5, 0.34, [{"text": title, "font": SANS_MED, "size": 20, "color": INK}])
        textbox(slide, 1.55, y + 0.34, 10.5, 0.32, [{"text": body, "font": SANS, "size": 15, "color": SMOKE}])
        y += 0.82
    rect(slide, 0, 6.22, 13.333, 1.28, INK)
    textbox(
        slide,
        0.72,
        6.48,
        9.3,
        0.78,
        [
            {
                "text": "No paying customers yet.",
                "font": SANS,
                "size": 16,
                "color": CREAM,
            },
            {
                "text": "The team pays when they need the hosted workspace.",
                "font": SANS,
                "size": 16,
                "color": "C8C2B8",
                "before": 2,
            },
        ],
    )
    textbox(
        slide,
        10.2,
        6.62,
        2.4,
        0.36,
        [{"text": "07  /  11", "font": MONO, "size": 12, "color": "8A8680", "align": "right"}],
        align="right",
    )
    notes(
        slide,
        """
OPEN: Open source gets us into the workflow. Cloud is how the team stays there.

Walk the four steps. A developer installs locally. They start coordinating agents. They invite a teammate. That is the moment they need a hosted shared workspace, and that is what they pay for. The hosted product is what this round builds. It is not live.

If they ask about revenue, say it once: no paying customers yet. Then return to the path. Do not lead with the absence.

The buyer is still the lead of a 3-20 person team already on more than one coding agent. That profile is the product definition, not a measured segment. Stars are not traction.

LAND: The conversion is the product. Local stays open source. The hosted workspace is closed, and paid, when a team needs it.
        """,
    )


def scaling(prs, blank):
    slide = prs.slides.add_slide(blank)
    set_bg(slide, PAPER)
    kicker(slide, "08", "SCALING")
    textbox(
        slide,
        0.72,
        0.90,
        12.2,
        1.45,
        [
            {"text": "Another harness is a new client.", "font": SERIF, "size": 40, "italic": True, "color": INK, "line": 0.95},
        ],
    )
    rows = [
        (
            "01",
            "The workspace does not care which vendor ships next.",
            "Codex and OpenCode already share one workspace. Claude Code and Cursor are not validated yet.",
        ),
        (
            "02",
            "Correctness does not call a model.",
            "Authorization, identity, and history are deterministic. The system of record has no token bill.",
        ),
        (
            "03",
            "One workspace is enough to matter.",
            "A team gets value before anyone builds org-wide memory. We will not build that ahead of the proof.",
        ),
    ]
    y = 2.50
    for num, title, body in rows:
        textbox(slide, 0.72, y, 0.7, 0.4, [{"text": num, "font": SERIF, "size": 20, "italic": True, "color": EMBER}])
        textbox(slide, 1.55, y - 0.02, 10.8, 0.38, [{"text": title, "font": SANS_MED, "size": 20, "color": INK}])
        textbox(slide, 1.55, y + 0.40, 10.8, 0.45, [{"text": body, "font": SANS, "size": 15, "color": SMOKE}])
        y += 1.22
    footer(slide, "08  /  11")
    notes(
        slide,
        """
OPEN: We do not scale by rewriting the product every time a new agent ships.

Walk the three. Harness independence is the actual architecture: the domain does not import a vendor session schema. MCP is a thin edge. Authorization happens before state is returned to a harness. An LLM is not in the path that decides whether something exists, who wrote it, or who may read it.

LAND: Another harness is another client of the same workspace. I am not hiring. The hosted workspace is how a second person gets onto the work without a shared laptop. I build that myself. The two-machine proof is still open, so this is not a motion that runs without me.

Campfire is not an orchestration engine, and it is not a chat product. If they want swarms, or a Slack replacement, this is the wrong meeting. Say so. The hosted offering is the Campfire record in the cloud: goal, finding, decision, history. The transcript still stays private.
        """,
    )


def money(prs, blank):
    slide = prs.slides.add_slide(blank)
    set_bg(slide, PAPER)
    kicker(slide, "09", "THE MONEY")
    textbox(
        slide,
        0.72,
        0.88,
        12,
        1.45,
        [
            {"text": "$500k to bring Campfire Cloud", "font": SERIF, "size": 36, "italic": True, "color": INK, "line": 0.95},
            {"text": "to market.", "font": SERIF, "size": 36, "italic": True, "color": EMBER, "line": 0.95},
        ],
    )
    textbox(
        slide,
        0.74,
        2.48,
        11,
        0.4,
        [{"text": "18 months. One founder. No immediate hires.", "font": SANS, "size": 18, "color": SMOKE}],
    )
    columns = [
        (
            5.15,
            "$300k",
            "PRODUCT & GROWTH",
            "Build and scale the hosted workspace. Support more developers, teams, and agents. Invest in infrastructure, distribution, and adoption.",
        ),
        (
            3.43,
            "$200k",
            "COMPANY & OPERATIONS",
            "Founder salary, legal, accounting, and operating expenses. The runway to build Campfire full-time.",
        ),
    ]
    x = 0.72
    for width, amount, title, body in columns:
        rect(slide, x, 3.15, width, 0.08, EMBER)
        textbox(slide, x, 3.38, 5.7, 0.55, [{"text": amount, "font": SERIF, "size": 36, "italic": True, "color": INK}])
        textbox(
            slide,
            x,
            4.05,
            5.7,
            0.32,
            [{"text": title, "font": MONO_MED, "size": 13, "color": EMBER, "spacing": 80}],
        )
        textbox(
            slide,
            x,
            4.48,
            5.55,
            1.45,
            [{"text": body, "font": SANS, "size": 16, "color": INK, "line": 1.25}],
        )
        x += 6.35
    textbox(
        slide,
        0.72,
        6.15,
        11.8,
        0.5,
        [
            {
                "text": "Local stays open source. Cloud becomes the business.",
                "font": SERIF,
                "size": 20,
                "italic": True,
                "color": INK,
            }
        ],
    )
    footer(slide, "09  /  11")
    notes(
        slide,
        """
OPEN: Five hundred thousand to bring Campfire Cloud to market. Eighteen months. One founder. No immediate hires.

Three hundred thousand is product and growth. Build and scale the hosted workspace. Support more developers, teams, and agents. Infrastructure, distribution, and adoption.

Two hundred thousand is the company. Founder salary, legal, accounting, and operating expenses. That is the runway to build Campfire full-time. It is not a hiring plan.

LAND: Local stays open source. Cloud becomes the business. The hosted product is not live yet, and it is not open source.

If they compare it to Ando: Ando is team messaging. Campfire Cloud is the shared record. Goal, finding, decision, history. Agents stay the agents they already use.
        """,
    )


def next_round(prs, blank):
    slide = prs.slides.add_slide(blank)
    set_bg(slide, PAPER)
    kicker(slide, "10", "THE NEXT ROUND")
    textbox(
        slide,
        0.72,
        0.88,
        12.2,
        1.55,
        [
            {"text": "From a tool developers install", "font": SERIF, "size": 34, "italic": True, "color": INK, "line": 0.98},
            {"text": "to infrastructure teams depend on.", "font": SERIF, "size": 34, "italic": True, "color": EMBER, "line": 0.98},
        ],
    )
    lines = [
        ("01", "Eight teams come back on a later day, without a nudge."),
        ("02", "Campfire Cloud is in production."),
        ("03", "Those teams pay to keep using it."),
        ("04", "A second harness continues the work. The handoff is proven."),
        ("05", "The shared record is how the team stays aligned."),
    ]
    y = 2.65
    for num, line in lines:
        textbox(slide, 0.72, y, 0.6, 0.36, [{"text": num, "font": MONO_MED, "size": 14, "color": EMBER}])
        textbox(slide, 1.50, y, 11.0, 0.55, [{"text": line, "font": SANS, "size": 18, "color": INK}])
        y += 0.72
    footer(slide, "10  /  11")
    notes(
        slide,
        """
OPEN: The next round is the business, not a longer feature list.

Read the first line slowly. Eight teams coming back, unasked, is the retention signal. Then the platform: Campfire Cloud in production. Then revenue: those teams pay. Then the product proof: a second harness continues the work, and nobody forwarded a transcript. Then the dependence: the shared record is how the team stays aligned.

None of that is true yet. The hosted product is what this round builds. Enrollment exists. A two-human trace we did not run ourselves does not.

INTERNAL, do not say it as a restriction: if these five are not true, do not raise the next round. That is our bar, not a promise to investors about how we finance.

LAND: From a tool a developer installs, to infrastructure a team depends on.

Plain language for our own gates, if they have read the repo: one is Gate B, and the handoff is Gate C. Do not make them learn the internal names unless they ask. Viewer comprehension stays a diligence topic.
        """,
    )


def advantage(prs, blank):
    slide = prs.slides.add_slide(blank)
    set_bg(slide, INK)
    kicker(slide, "11", "UNFAIR ADVANTAGE", color=EMBER)
    textbox(
        slide,
        0.72,
        0.92,
        12,
        1.7,
        [
            {"text": "We are not building the agent.", "font": SERIF, "size": 40, "italic": True, "color": CREAM, "line": 0.98},
        ],
    )
    points = [
        ("01", "The labs will keep making agents better. We keep the place a team’s agents meet, and the human who decides."),
        ("02", "Authorization runs before any context enters a harness. The trust boundary is the architecture."),
        ("03", "The record survives a vendor. Codex and OpenCode already continue the same workspace."),
        ("04", "The missing proof sits in the repo next to the code. Diligence is a git clone."),
    ]
    y = 2.75
    for num, line in points:
        textbox(slide, 0.72, y, 0.55, 0.36, [{"text": num, "font": MONO_MED, "size": 13, "color": EMBER}])
        textbox(slide, 1.45, y, 11.0, 0.55, [{"text": line, "font": SANS, "size": 18, "color": CREAM}])
        y += 0.72
    textbox(
        slide,
        0.72,
        5.85,
        12,
        0.9,
        [
            {"text": "The work that belongs to the team", "font": SERIF, "size": 24, "italic": True, "color": FIRE, "line": 1.0},
            {"text": "can belong to the team.", "font": SERIF, "size": 24, "italic": True, "color": FIRE, "line": 1.0},
        ],
    )
    footer(slide, "11  /  11", dark=True)
    notes(
        slide,
        """
OPEN: We are not building the agent. The labs are better at that, and they should keep going.

Then stop selling and name the four things that are actually hard to copy quickly: a team-shaped place, authorization before retrieval, a domain that outlives one vendor, and a repo that publishes the unfinished proof. Most teams at this stage hide the gap. We wrote the conditional verdict into the release.

Codex and OpenCode are the validated pair. Do not upgrade that sentence under pressure.

LAND, then stop talking: The work that belongs to the team can belong to the team.

If the room is still with you, the only question left is whether they want to help prove the five lines on the previous slide.
        """,
    )


SPEAKER = """# Campfire pre-seed, round one

How to use this deck. The slides are a leave-behind. Say the open line, land on the last line, and let them interrupt.

Ask: **$500k** for eighteen months. One founder. No hire. The build is a hosted team workspace. That product is paid and closed. The local tool stays Apache-2.0.

The hosted product is not live. The public site is still local-first. Say that if they have read it.

Frame the meeting out loud, once: "I have a deck, but I would rather make this a conversation. Jump in whenever."

## 01 Cover

Open: I brought a deck. I would rather have the conversation. Jump in whenever.

Land: We are raising five hundred thousand dollars. One founder, eighteen months, no hire. A hosted workspace a team pays for.

## 02 Why this

Open: Close the terminal. Right now the work goes with it.

Land: The transcript stays on their machine. The decision stays with the team.

## 03 Why now

Open: This showed up in the repository this year. The team structure did not.

Land: The labs will keep shipping agents. The place those agents meet is still empty.

There is no TAM on purpose. We do not have a sourced one.

## 04 Why you

Open: I did not start with a category. I started with the workflow.

Land: Design engineer, ten-plus years. Campfire is what I needed across multiple coding agents. v0.1 to v1.12 in just a month.

Save field trace and Viewer comprehension for diligence, not this slide.

## 05 Product

Open: Stop talking and show the room.

Land: Two humans, multiple agents, one workspace. Point at the Viewer. The numbers are next.

Diligence only: Viewer comprehension, harness validation gaps, field trace.

## 06 Early traction

Open: Developers are showing up. And some of them are coming back.

851 activated. 536 ever active. 478 active in the week beginning October 4. Peak day 218.

These are installation ids, not developers or teams. Activated is a first real use. Active is a later workspace read, once per installation per day. Not a heartbeat.

119 to 478 is inside the same week. Do not call it week-over-week. Leave the percentages off the slide.

Land: Real product, people activating it, some using it again. Not product-market fit.

## 07 Selling

Open: Open source gets us into the workflow. Cloud brings teams together.

Walk it: install locally, coordinate agents, invite teammates, then the hosted workspace.

Land: The conversion is the product. No paying customers yet. Say it if they ask, not as the headline.

Do not cite stars or test counts as customers. The hosted product is the build, not a thing you can demo as live.

## 08 Scaling

Open: A new agent does not mean a new product.

Land: Another harness is another client. No hire. The hosted workspace is how a second person gets onto the work.

## 09 The money

Open: Five hundred thousand to bring Campfire Cloud to market. Eighteen months. One founder. No immediate hires.

$300k product and growth. Build and scale the hosted workspace.
$200k company and operations. Founder salary, legal, accounting, and the runway to build full-time.

Land: Local stays open source. Cloud becomes the business.

## 10 The next round

Open: The next round is the business, not a longer feature list.

Eight teams come back unasked. Campfire Cloud is in production. Those teams pay. A second harness continues the work. The shared record is how the team stays aligned.

Land: From a tool developers install, to infrastructure teams depend on.

Internal only: if these five are not true, do not raise the next round. Do not say that as a financing restriction.

## 11 Unfair advantage

Open: We are not building the agent.

Land, then stop: The work that belongs to the team can belong to the team.
"""


def main() -> None:
    prs = build()
    prs.save(OUT)
    (ROOT / "SPEAKER.md").write_text(SPEAKER, encoding="utf-8")
    print(OUT)


if __name__ == "__main__":
    main()
