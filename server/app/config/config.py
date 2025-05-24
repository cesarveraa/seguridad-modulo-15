# --------------------------------------------------
# OpenAI client (SambaNova)
# --------------------------------------------------
import os
from openai import OpenAI
client = OpenAI(
    api_key=os.getenv("SAMBANOVA_API_KEY"),
    base_url=os.getenv("SAMBANOVA_API_BASE", "https://api.sambanova.ai/v1"),
)
