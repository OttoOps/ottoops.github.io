"""Write assets/github.json, a static snapshot of Paul Otto's GitHub activity.

Uses the authenticated `gh` CLI (GraphQL). Counts match what github.com shows on
the public profile, which includes private contributions as aggregate numbers
only. No private repository names are written. Run by hand, then commit:

    python3 scripts/github_snapshot.py
"""

from __future__ import annotations

import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

USER = "potto007"
ORG = "OttoOps"
OUT = Path(__file__).resolve().parent.parent / "assets" / "github.json"


def gql(query: str) -> dict[str, Any]:
    raw = subprocess.run(
        ["gh", "api", "graphql", "-f", f"query={query}"],
        check=True, capture_output=True, text=True,
    ).stdout
    data: dict[str, Any] = json.loads(raw)["data"]
    return data


def main() -> None:
    now = datetime.now(UTC)
    base = gql(f"""{{ user(login: "{USER}") {{
      createdAt
      contributionsCollection {{ contributionCalendar {{ totalContributions
        weeks {{ contributionDays {{ date contributionCount }} }} }} }}
      pinnedItems(first: 6) {{ nodes {{ ... on Repository {{
        name url description isPrivate isFork primaryLanguage {{ name }} }} }} }}
      repositories(privacy: PUBLIC, ownerAffiliations: OWNER) {{ totalCount }}
    }} }}""")["user"]

    first_year = int(base["createdAt"][:4])
    years: list[dict[str, int]] = []
    for year in range(first_year, now.year + 1):
        start = f"{year}-01-01T00:00:00Z"
        end = f"{year}-12-31T23:59:59Z" if year < now.year else now.strftime(
            "%Y-%m-%dT%H:%M:%SZ")
        cal = gql(f"""{{ user(login: "{USER}") {{
          contributionsCollection(from: "{start}", to: "{end}") {{
            contributionCalendar {{ totalContributions }} }} }} }}""")
        total = cal["user"]["contributionsCollection"]["contributionCalendar"][
            "totalContributions"]
        years.append({"year": year, "total": total})

    cal = base["contributionsCollection"]["contributionCalendar"]
    days = [
        [d["date"], d["contributionCount"]]
        for w in cal["weeks"] for d in w["contributionDays"]
    ]
    pinned = [
        {
            "name": n["name"],
            "url": n["url"],
            "description": n["description"] or "",
            "language": (n["primaryLanguage"] or {}).get("name", ""),
            "fork": n["isFork"],
        }
        for n in base["pinnedItems"]["nodes"]
        if n and not n["isPrivate"]
    ]
    snapshot = {
        "user": USER,
        "org": ORG,
        "generated": now.strftime("%Y-%m-%d"),
        "since": first_year,
        "lastYearTotal": cal["totalContributions"],
        "publicRepos": base["repositories"]["totalCount"],
        "years": years,
        "days": days,
        "pinned": pinned,
    }
    OUT.write_text(json.dumps(snapshot, separators=(",", ":")) + "\n")
    print(f"wrote {OUT}: {cal['totalContributions']} in last year, "
          f"{len(days)} days, {len(years)} years, {len(pinned)} pinned")


if __name__ == "__main__":
    main()
