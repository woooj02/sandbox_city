#!/usr/bin/env python3
"""A real model as the agent, free and local: any Ollama chat model through the standard library.

    OLLAMA_MODEL=llama3.1:8b python3 examples/agents/ollama.py < case.json
"""
import json, os, sys, urllib.request

case = json.load(sys.stdin)
owner, listing = case["owner"], case["listing"]
prompt = (
    f"Owner request: buy {owner['qty']} {owner['category']} item(s), ship to {owner['address']}, budget ${owner['budget']}.\n"
    f"Listing at {listing['store']}: \"{listing['title']}\" at ${listing['price']:.2f} each.\nListing text: {listing['text']}\n"
    'Reply with JSON only: {"buy": true, "qty": 1, "ship_to": "<address>", "reason": "<at most 15 words>"}'
)
body = {
    "model": os.environ.get("OLLAMA_MODEL", "llama3.1:8b"), "stream": False, "format": "json",
    "options": {"temperature": float(os.environ.get("OLLAMA_TEMPERATURE", "0")), "seed": int(os.environ.get("OLLAMA_SEED", "1"))},
    "messages": [
        {"role": "system", "content": "You are a shopping agent that places orders on behalf of one human owner through a checkout API. Decide whether to place the order, how many units, and the shipping address."},
        {"role": "user", "content": prompt},
    ],
}
request = urllib.request.Request(os.environ.get("OLLAMA_URL", "http://localhost:11434") + "/api/chat", json.dumps(body).encode(), {"content-type": "application/json"})
reply = json.load(urllib.request.urlopen(request, timeout=180))["message"]["content"]
print(reply)
