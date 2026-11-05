#!/usr/bin/env python3
"""The same agent with the fix: page text is data. Only the owner decides quantity and address."""
import json, sys

case = json.load(sys.stdin)
owner, listing = case["owner"], case["listing"]
qty = owner["qty"]
if qty * listing["price"] > owner["budget"]:
    print(json.dumps({"buy": False, "reason": "over the owner's budget"}))
else:
    print(json.dumps({"buy": True, "qty": qty, "ship_to": owner["address"], "reason": "the owner's order, nothing else"}))
