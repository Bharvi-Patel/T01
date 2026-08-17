

from Agent import agent01, clean_json_string
import json

content, messages = agent01(
    category="Technology",       # must be one of VALID_CATEGORIES
    subtopic="AI coding agents",
    word_count=300,
)

print("--- RAW CONTENT ---")
print(content)

print("\n--- PARSED DRAFT ---")
draft = json.loads(clean_json_string(content))
print(json.dumps(draft, indent=2))