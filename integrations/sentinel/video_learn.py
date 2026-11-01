"""Sentinel video learning - reads YouTube transcripts, extracts trading rules.

Uses youtube-transcript-api v1.x (instance-based fetch method).
"""

import re
import json

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    HAS_YT = True
except ImportError:
    HAS_YT = False


def extract_video_id(url):
    m = re.search(
        r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/|"
        r"youtube\.com/embed/)([A-Za-z0-9_-]{10,12})", url)
    if not m:
        return None
    vid = m.group(1)
    return vid


def _snippets_to_text(snippets):
    parts = []
    for item in snippets:
        if isinstance(item, dict):
            parts.append(item.get("text", ""))
        elif hasattr(item, "text"):
            parts.append(item.text)
        else:
            parts.append(str(item))
    text = " ".join(parts)
    return re.sub(r"\s+", " ", text).strip()


def fetch_transcript(video_id):
    """Return (text, error). Uses v1.x API."""
    if not HAS_YT:
        return None, "youtube-transcript-api not installed"

    # ---- v1.x: instance-based fetch() ----
    try:
        api = YouTubeTranscriptApi()
        fetched = api.fetch(video_id)
        # FetchedTranscript object — access .snippets
        if hasattr(fetched, "snippets"):
            text = _snippets_to_text(fetched.snippets)
        else:
            text = _snippets_to_text(list(fetched))
        if text:
            return text, None
        return None, "empty transcript"
    except Exception as e:
        err_v1 = f"{type(e).__name__}: {e}"

    # ---- v0.6.x fallback ----
    if hasattr(YouTubeTranscriptApi, "get_transcript"):
        try:
            data = YouTubeTranscriptApi.get_transcript(video_id)
            text = _snippets_to_text(data)
            if text:
                return text, None
        except Exception as e:
            err_v06 = f"{type(e).__name__}: {e}"
        else:
            err_v06 = None
    else:
        err_v06 = "get_transcript not available"

    return None, f"v1.x error: {err_v1} | v0.6.x error: {err_v06}"


def chunk_text(text, max_chars=12000):
    if len(text) <= max_chars:
        return [text]
    chunks = []
    words = text.split()
    current, size = [], 0
    for w in words:
        current.append(w)
        size += len(w) + 1
        if size >= max_chars:
            chunks.append(" ".join(current))
            current, size = [], 0
    if current:
        chunks.append(" ".join(current))
    return chunks


EXTRACT_PROMPT = """You are analyzing a YouTube transcript for a trading bot.

Extract 3-7 concrete, actionable trading rules from the content.

Format each rule as a short instruction:
- "Only enter when X and Y are both true"
- "Avoid trading during Z"
- "Prefer setups where A exceeds B"
- "Exit when C happens"

Requirements:
- Be SPECIFIC and OPERATIONAL
- Each rule must be checkable as a condition
- Skip mindset, motivation, general advice
- Skip anything about "believing in yourself" or "discipline"
- If no actionable rules exist, return empty list

Output ONLY valid JSON:
{"lessons": [{"category": "setup|risk|timing|management|avoid", "rule": "..."}]}

Transcript:
---
{transcript}
---"""


def extract_lessons(transcript_text, llm_call):
    chunks = chunk_text(transcript_text)
    all_lessons = []
    seen = set()
    for chunk in chunks:
        user = EXTRACT_PROMPT.replace("{transcript}", chunk)
        try:
            reply = llm_call(
                "You extract structured trading rules from text.", user)
            reply = re.sub(r"```json|```", "", reply).strip()
            data = json.loads(reply)
            for lesson in data.get("lessons", []):
                cat = lesson.get("category", "general")
                rule = lesson.get("rule", "").strip()
                if rule and rule not in seen:
                    seen.add(rule)
                    all_lessons.append({"category": cat, "rule": rule})
        except Exception:
            continue
    return all_lessons
