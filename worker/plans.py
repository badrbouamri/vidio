"""
M7.1/M7.5: plan limits relevant to rendering (watermark, resolution).

Mirrors src/lib/plans.ts's PLAN_LIMITS — kept in sync manually since there's
no shared package between the Python worker and the Next.js app. Only the
fields render.py actually needs live here; minutes/gating logic stays
TS-side (src/lib/plans.ts), where the API routes that enforce it live.
"""

# "max_height" names the plan's "720p"/"1080p" figure — for our 9:16
# portrait output that's actually the WIDTH (1080x1920 is what everyone
# calls "1080p" vertical video); main.py does the width->height conversion.
PLAN_LIMITS = {
    "free": {"watermark": True, "max_height": 720},
    "pro": {"watermark": False, "max_height": 1080},
}


def render_settings_for_plan(plan: str) -> dict:
    return PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
