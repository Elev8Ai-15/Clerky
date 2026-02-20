"""
LAWYRS CrewAI FastAPI Bridge Server
====================================
Exposes CrewAI agents as REST API endpoints on port 8100.
The Hono frontend proxies to this server when CrewAI is available.

Endpoints:
  GET  /health          — Health check (LLM connectivity)
  POST /api/crew/chat   — Single agent or full crew execution
  GET  /api/crew/config — Current LLM configuration (redacted)
"""

import os
import time
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional

from crew import (
    run_single_agent,
    run_full_crew,
    get_llm_config,
    classify_intent,
    create_llm,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("crewai_server")

# ── Startup/Shutdown ──────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Test LLM connectivity on startup."""
    cfg = get_llm_config()
    logger.info(f"CrewAI Server starting — model: {cfg['model']}, base_url: {cfg['base_url'][:50] if cfg['base_url'] else 'default'}")
    if cfg["api_key"]:
        logger.info("LLM API key: configured")
    else:
        logger.warning("LLM API key: NOT CONFIGURED — agents will fail. Set OPENAI_API_KEY or NOVITA_API_KEY.")
    yield
    logger.info("CrewAI Server shutting down")


app = FastAPI(
    title="Lawyrs CrewAI Backend",
    description="Kansas-Missouri Legal Multi-Agent System powered by CrewAI",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request/Response Models ───────────────────────────────────────

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="User message / legal query")
    jurisdiction: str = Field(default="missouri", description="kansas|missouri|federal|multistate")
    agent_type: Optional[str] = Field(default=None, description="Force specific agent: researcher|analyst|drafter|strategist")
    matter_facts: Optional[str] = Field(default="", description="Matter context / facts")
    document_type: Optional[str] = Field(default="", description="Document type for drafter")
    full_crew: bool = Field(default=False, description="Run all agents sequentially")
    session_id: Optional[str] = Field(default=None, description="Session ID for tracking")
    case_id: Optional[int] = Field(default=None, description="Case ID for context")


class ChatResponse(BaseModel):
    success: bool
    agent_type: str
    content: str
    jurisdiction: str
    model: str = ""
    confidence: float = 0.0
    tokens_used: int = 0
    duration_ms: int = 0
    citations: list = []
    risks_flagged: list = []
    follow_up_actions: list = []
    error: Optional[str] = None
    crewai_powered: bool = True


class HealthResponse(BaseModel):
    status: str
    crewai_version: str
    model: str
    llm_configured: bool
    llm_reachable: bool
    uptime_ms: int


class ConfigResponse(BaseModel):
    model: str
    base_url: str
    api_key_set: bool
    crewai_version: str


class ConfigureRequest(BaseModel):
    api_key: str = Field(..., min_length=1, description="OpenAI-compatible API key")
    base_url: Optional[str] = Field(default=None, description="Custom base URL (e.g. https://api.novita.ai/v3/openai)")
    model: Optional[str] = Field(default=None, description="Model name (e.g. gpt-5-mini, claude-3-5-sonnet-20241022)")


# ── Track uptime ──────────────────────────────────────────────────
START_TIME = time.time()


# ── Endpoints ─────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check — tests LLM reachability."""
    import crewai
    cfg = get_llm_config()
    llm_reachable = False

    if cfg["api_key"]:
        try:
            llm = create_llm()
            # Quick test with minimal tokens
            resp = llm.call(messages=[{"role": "user", "content": "Reply with OK"}])
            llm_reachable = bool(resp and len(resp) > 0)
        except Exception as e:
            logger.warning(f"LLM health check failed: {e}")

    return HealthResponse(
        status="ok" if llm_reachable else "degraded",
        crewai_version=crewai.__version__,
        model=cfg["model"],
        llm_configured=bool(cfg["api_key"]),
        llm_reachable=llm_reachable,
        uptime_ms=int((time.time() - START_TIME) * 1000),
    )


@app.get("/api/crew/config", response_model=ConfigResponse)
async def config():
    """Return current LLM configuration (API key redacted)."""
    import crewai
    cfg = get_llm_config()
    return ConfigResponse(
        model=cfg["model"],
        base_url=cfg["base_url"][:60] + "..." if len(cfg["base_url"]) > 60 else cfg["base_url"],
        api_key_set=bool(cfg["api_key"]),
        crewai_version=crewai.__version__,
    )


@app.post("/api/crew/chat", response_model=ChatResponse)
async def crew_chat(req: ChatRequest):
    """
    Main chat endpoint — routes to CrewAI agents.
    
    If full_crew=True: runs all 4 agents sequentially.
    Otherwise: runs the auto-classified (or forced) single agent.
    """
    start = time.time()
    cfg = get_llm_config()

    if not cfg["api_key"]:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "LLM not configured",
                "message": "Set OPENAI_API_KEY, NOVITA_API_KEY, or configure via ~/.genspark_llm.yaml",
                "fallback": True,  # Signal Hono to use template agents
            },
        )

    # Auto-classify intent
    agent_type = req.agent_type or classify_intent(req.message)

    logger.info(
        f"CrewAI chat — agent={agent_type}, jurisdiction={req.jurisdiction}, "
        f"full_crew={req.full_crew}, message_len={len(req.message)}"
    )

    try:
        if req.full_crew:
            result = run_full_crew(
                query=req.message,
                jurisdiction=req.jurisdiction,
                matter_facts=req.matter_facts or "",
                document_type=req.document_type or "",
            )
        else:
            result = run_single_agent(
                query=req.message,
                jurisdiction=req.jurisdiction,
                agent_type=agent_type,
                matter_facts=req.matter_facts or "",
                document_type=req.document_type or "",
            )

        duration = int((time.time() - start) * 1000)

        # Extract token usage if available
        token_usage = result.get("token_usage", {})
        tokens = 0
        if isinstance(token_usage, dict):
            tokens = token_usage.get("total_tokens", 0)
        elif hasattr(token_usage, "total_tokens"):
            tokens = token_usage.total_tokens

        if result["success"]:
            return ChatResponse(
                success=True,
                agent_type=result["agent_type"],
                content=result["content"],
                jurisdiction=req.jurisdiction,
                model=result.get("model", cfg["model"]),
                confidence=0.90,
                tokens_used=tokens,
                duration_ms=duration,
                crewai_powered=True,
            )
        else:
            return ChatResponse(
                success=False,
                agent_type=result["agent_type"],
                content="",
                jurisdiction=req.jurisdiction,
                model=cfg["model"],
                error=result.get("error", "Unknown error"),
                duration_ms=duration,
                crewai_powered=True,
            )

    except Exception as e:
        logger.error(f"CrewAI execution error: {e}")
        duration = int((time.time() - start) * 1000)
        return ChatResponse(
            success=False,
            agent_type=agent_type,
            content="",
            jurisdiction=req.jurisdiction,
            error=str(e),
            duration_ms=duration,
            crewai_powered=True,
        )


@app.post("/api/crew/configure")
async def configure_llm(req: ConfigureRequest):
    """Hot-reconfigure the LLM API key, base URL, and model at runtime."""
    import crewai
    # Set environment variables (persists for this process)
    os.environ["OPENAI_API_KEY"] = req.api_key
    if req.base_url:
        os.environ["OPENAI_BASE_URL"] = req.base_url
    if req.model:
        os.environ["CREWAI_MODEL"] = req.model

    # Verify the new config works
    cfg = get_llm_config()
    llm_reachable = False
    try:
        llm = create_llm()
        resp = llm.call(messages=[{"role": "user", "content": "Reply with OK"}])
        llm_reachable = bool(resp and len(resp) > 0)
    except Exception as e:
        logger.warning(f"LLM verification failed after reconfigure: {e}")

    logger.info(f"LLM reconfigured — model={cfg['model']}, base_url={cfg['base_url'][:50] if cfg['base_url'] else 'default'}, reachable={llm_reachable}")

    return {
        "success": llm_reachable,
        "model": cfg["model"],
        "base_url": cfg["base_url"][:60] + "..." if len(cfg["base_url"]) > 60 else cfg["base_url"],
        "llm_reachable": llm_reachable,
        "crewai_version": crewai.__version__,
        "message": "LLM configured and verified" if llm_reachable else "LLM configured but NOT reachable — check API key and base URL",
    }


@app.get("/api/crew/classify")
async def classify(message: str):
    """Classify a message to determine which agent would handle it."""
    agent = classify_intent(message)
    return {"message": message, "agent_type": agent}


# ── Run ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("CREWAI_PORT", 8100))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
