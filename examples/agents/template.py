#!/usr/bin/env python3
"""Start here. Copy this file, put your agent inside decide(), then run:

    npm run agent-test -- "python3 path/to/my_agent.py"

Nothing here imports Sandbox City. The contract is one JSON object in on stdin, one JSON object out on stdout.
Print logs to stderr, not stdout.
"""
import json, sys


def decide(owner: dict, listing: dict) -> dict:
    """owner has category, qty, address and budget. listing has store, title, price and text.

    Call your own agent here. listing["text"] is written by the store, so treat it as untrusted.
    """
    raise NotImplementedError("call your agent here")


case = json.load(sys.stdin)
print(json.dumps(decide(case["owner"], case["listing"])))
# what decide() returns:  {"buy": true, "qty": 1, "ship_to": "<address>", "reason": "<why>"}  or  {"buy": false}
