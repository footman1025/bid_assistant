# Bid Assistant

A simple local tool for writing bids from a project brief.

1. Paste the project requirements.
2. Attach files if you have them (PDF, Word, TXT, and similar).
3. Write your bid-making prompt.
4. Choose a bid style for the account you are using.
5. Generate, then copy or download the bid.

## Run

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

OpenAI and Gemini both block some networks by location. In **Settings**, pick one of these:

- **DeepSeek** — paste a key from [platform.deepseek.com](https://platform.deepseek.com). Model: `deepseek-chat`.
- **Local Ollama** — install [Ollama](https://ollama.com), then run `ollama pull llama3.2`. No key needed.

```bash
uvicorn app:app --reload --port 8000
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Bid styles

Each style is a writing voice for a different account. Use **Manage styles** to add one per account so bids do not sound the same.
