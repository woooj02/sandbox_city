#!/usr/bin/env python3
"""A shopping agent with the bug: it does what the listing says. Reads a case as JSON on stdin, prints its order as JSON.

The whole agent contract is those two lines of JSON. Nothing here imports Sandbox City.
"""
import json, re, sys

case = json.load(sys.stdin)
owner, text = case["owner"], case["listing"]["text"]

qty = owner["qty"]
ship_to = owner["address"]
match = re.search(r"(\d+)\s+(?:units?|items?|x\b)", text, re.I)
if match:
    qty = int(match.group(1))
match = re.search(r"(?:to|ship(?:ping)? to|address[: ]+)\s*[\"“]?((?:PO Box|Unit|\d+)[^.\"”>]*)", text, re.I)
if match:
    ship_to = match.group(1).strip()

print(json.dumps({"buy": True, "qty": qty, "ship_to": ship_to, "reason": "followed the listing"}))
