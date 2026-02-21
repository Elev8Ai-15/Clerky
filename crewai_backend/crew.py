"""
LAWYRS CrewAI Legal Crew — Kansas-Missouri Multi-Agent System
=============================================================
Four specialist agents (Researcher, Analyst, Drafter, Strategist)
orchestrated by CrewAI with hierarchical process management.

Designed to work with any OpenAI-compatible LLM endpoint.
Reads config from environment or ~/.genspark_llm.yaml.
"""

import datetime
import os
import yaml
from crewai import Agent, Crew, Task, Process, LLM

# ── LLM Configuration ────────────────────────────────────────────
def get_llm_config() -> dict:
    """Resolve LLM config from env vars or YAML config file."""
    # Priority 1: Direct env vars
    api_key = os.environ.get("OPENAI_API_KEY", "")
    base_url = os.environ.get("OPENAI_BASE_URL", "")
    model = os.environ.get("CREWAI_MODEL", "gpt-5-mini")

    # Priority 2: YAML config file
    yaml_path = os.path.expanduser("~/.genspark_llm.yaml")
    if os.path.exists(yaml_path):
        try:
            with open(yaml_path) as f:
                cfg = yaml.safe_load(f)
            if cfg and "openai" in cfg:
                oc = cfg["openai"]
                # Only use YAML values if they look like real keys (not template vars)
                yaml_key = oc.get("api_key", "")
                yaml_url = oc.get("base_url", "")
                if yaml_key and not yaml_key.startswith("${"):
                    api_key = yaml_key
                if yaml_url and not yaml_url.startswith("${"):
                    base_url = yaml_url
        except Exception:
            pass

    # Priority 3: Novita AI endpoint (user's snippet)
    novita_key = os.environ.get("NOVITA_API_KEY", "")
    novita_url = os.environ.get("NOVITA_BASE_URL", "https://api.novita.ai/v3/openai")
    if novita_key and not api_key:
        api_key = novita_key
        base_url = novita_url
        model = os.environ.get("CREWAI_MODEL", "claude-3-5-sonnet-20241022")

    return {
        "api_key": api_key,
        "base_url": base_url,
        "model": model,
    }


def create_llm() -> LLM:
    """Create a CrewAI LLM instance from resolved config."""
    cfg = get_llm_config()
    kwargs = {
        "model": cfg["model"],
        "temperature": 0.1,
        "max_tokens": 4096,
    }
    if cfg["api_key"]:
        kwargs["api_key"] = cfg["api_key"]
    if cfg["base_url"]:
        kwargs["base_url"] = cfg["base_url"]
    return LLM(**kwargs)


# ── KS/MO System Prompt (battle-tested from v3.2) ────────────────
CURRENT_DATE = datetime.date.today().isoformat()

KS_MO_SYSTEM = f"""You are Clerky AI Senior Partner — 25+ years experience, licensed in Kansas and Missouri.
Current date: {CURRENT_DATE}.

KANSAS RULES (auto-apply when jurisdiction = Kansas):
- K.S.A. (2025-2026 session) — primary statutory authority
- K.S.A. 60-513: 2-year PI/negligence SOL — always flag deadline
- K.S.A. 60-258a: Modified comparative fault with 50% bar — plaintiff BARRED if >=50% at fault
- PROPORTIONAL FAULT ONLY: No joint & several liability; each defendant pays only proportionate share
- Empty-chair defense: Non-party fault allocation permitted
- No mandatory presuit notice for standard negligence (KTCA K.S.A. 75-6101 for govt entities)
- Kansas Supreme Court, Court of Appeals, District Courts + 10th Circuit precedent

MISSOURI RULES (auto-apply when jurisdiction = Missouri):
- RSMo (2025-2026 session) — primary statutory authority
- RSMo § 516.120: 5-year PI SOL — always flag deadline; RSMo § 516.105: 2-year med-mal SOL
- RSMo § 537.765: PURE comparative fault — plaintiff recovers even at 99% fault
- RSMo § 537.067: Joint & several liability ONLY when defendant >=51% at fault
- Mo.Sup.Ct.R. 55.05: FACT PLEADING required (stricter than federal notice pleading)
- Mo.Sup.Ct.R. 56.01(b): Discovery proportionality & ESI cost-shifting rules
- RSMo § 538.225: Affidavit of merit required for medical malpractice
- Missouri Supreme Court, Court of Appeals (Eastern/Western/Southern), Circuit Courts + 8th Circuit

CORE RULES:
1. Always think step-by-step and show your reasoning
2. NEVER hallucinate cases, statutes, or citations — verify on ksrevisor.gov or revisor.mo.gov
3. Always cite authoritative sources with pinpoint citations
4. Flag risks, SOL, ethical issues, and comparative-fault implications IMMEDIATELY
5. Maintain strict client confidentiality
6. Structure: Summary → Analysis → Recommendations → Next Actions → Sources
"""

# ── Agent Definitions ─────────────────────────────────────────────

def create_agents(llm: LLM) -> dict:
    """Create the four specialist agents."""

    researcher = Agent(
        role="Researcher Agent",
        goal=(
            "Find and cite the most recent, authoritative Kansas and Missouri "
            "case law, statutes, rules, and 8th/10th Circuit precedent. "
            "Auto-flag SOL deadlines and comparative fault rules."
        ),
        backstory=(
            "You are a 25-year Midwest litigator obsessed with pinpoint citations. "
            "You maintain embedded knowledge bases for K.S.A., RSMo, Kansas Supreme Court, "
            "Missouri Supreme Court, 8th Circuit, and 10th Circuit case law. "
            "You NEVER hallucinate a citation — if unsure, say 'verify on ksrevisor.gov or revisor.mo.gov'. "
            "You always include source URLs."
        ),
        llm=llm,
        verbose=True,
        allow_delegation=False,
        system_prompt=KS_MO_SYSTEM,
    )

    analyst = Agent(
        role="Analyst Agent",
        goal=(
            "Risk assessment, comparative fault calculation, outcome prediction, "
            "damages exposure analysis. Score risks 1-10 on six factors: "
            "liability, damages, SOL, comparative fault, evidence gaps, deadline management."
        ),
        backstory=(
            "You are a forensic strategist who always flags SOL risks, conflicts, "
            "and 50%/pure comparative implications. You produce quantified risk scorecards "
            "with SWOT analysis. For Kansas, emphasize proportional-only fault. "
            "For Missouri, emphasize J&S threshold at 51%."
        ),
        llm=llm,
        verbose=True,
        allow_delegation=False,
        system_prompt=KS_MO_SYSTEM,
    )

    drafter = Agent(
        role="Drafter Agent",
        goal=(
            "Produce perfect pleadings, demand letters, motions, complaints, and contracts "
            "in proper Kansas or Missouri format with all required sections and citations."
        ),
        backstory=(
            "You are a former AmLaw 100 associate who drafts faster and cleaner than any human. "
            "You know Kansas Supreme Court Rule 170 formatting, Missouri Mo.Sup.Ct.R. 55.03/55.05 "
            "fact-pleading requirements, and always include Certificates of Service. "
            "You output clean Markdown with [Citation] footnotes."
        ),
        llm=llm,
        verbose=True,
        allow_delegation=False,
        system_prompt=KS_MO_SYSTEM + "\nAlways output in clean Markdown with [Citation] footnotes.",
    )

    strategist = Agent(
        role="Strategist Agent",
        goal=(
            "Settlement strategies, litigation timelines, budget projections, "
            "venue analysis (KS vs MO forum selection), ADR recommendations, "
            "and proactive 'what am I missing?' checklists."
        ),
        backstory=(
            "You are a senior partner who thinks three moves ahead and calculates "
            "expected values. You know the MO Court of Appeals 3-district system, "
            "discovery proportionality budgeting under Mo.Sup.Ct.R. 56.01(b), "
            "and KS court-annexed mediation programs. You always provide "
            "3 strategic options with pros/cons and expected value calculations."
        ),
        llm=llm,
        verbose=True,
        allow_delegation=False,
        system_prompt=KS_MO_SYSTEM,
    )

    return {
        "researcher": researcher,
        "analyst": analyst,
        "drafter": drafter,
        "strategist": strategist,
    }


# ── Task Templates ────────────────────────────────────────────────

def create_research_task(agent: Agent, query: str, jurisdiction: str) -> Task:
    return Task(
        description=(
            f"Research the following legal question under {jurisdiction} law:\n\n"
            f"{query}\n\n"
            f"Provide:\n"
            f"1. Relevant statutes with pinpoint citations and URLs\n"
            f"2. Key case law with holdings and citations\n"
            f"3. SOL analysis and deadline flags\n"
            f"4. Comparative fault implications (KS 50% bar / MO pure comparative)\n"
            f"5. Procedural requirements specific to {jurisdiction}\n"
            f"6. Risks and verification notes\n"
            f"7. Recommended next actions"
        ),
        agent=agent,
        expected_output=(
            "Structured legal research memo with: Summary, Statutory Authority "
            "(with URLs), Case Law, SOL & Comparative Fault flags, Procedural "
            "Framework, Risks, and Next Actions."
        ),
    )


def create_analysis_task(agent: Agent, query: str, jurisdiction: str,
                         matter_facts: str = "") -> Task:
    return Task(
        description=(
            f"Perform a comprehensive risk analysis for the following matter "
            f"under {jurisdiction} law:\n\n"
            f"Query: {query}\n"
            f"Matter Facts: {matter_facts or 'Not specified'}\n\n"
            f"Score risks 1-10 on these factors:\n"
            f"- Liability Exposure\n"
            f"- Damages/Exposure\n"
            f"- SOL/Deadlines\n"
            f"- Comparative Fault Risk\n"
            f"- Evidence Gaps\n"
            f"- Deadline Management\n\n"
            f"Include SWOT analysis and damages scenarios."
        ),
        agent=agent,
        expected_output=(
            "Risk scorecard (table with factor/score/risk/notes), overall risk "
            "rating, SWOT analysis, comparative fault analysis, damages scenarios, "
            "and recommended actions."
        ),
    )


def create_drafting_task(agent: Agent, query: str, jurisdiction: str,
                         document_type: str = "", matter_facts: str = "") -> Task:
    doc_type = document_type or "legal document"
    return Task(
        description=(
            f"Draft a {doc_type} under {jurisdiction} law:\n\n"
            f"Instructions: {query}\n"
            f"Matter Facts: {matter_facts or 'General template'}\n\n"
            f"Include all required sections per {jurisdiction} rules:\n"
            f"- Proper caption and formatting\n"
            f"- All substantive sections\n"
            f"- Jurisdiction-specific requirements\n"
            f"- Certificate of Service\n"
            f"- Citation footnotes"
        ),
        agent=agent,
        expected_output=(
            f"Complete {doc_type} in Markdown format with proper caption, "
            f"all required sections, jurisdiction-specific requirements, "
            f"citations with [Footnote] format, and review checklist."
        ),
    )


def create_strategy_task(agent: Agent, query: str, jurisdiction: str,
                         matter_facts: str = "") -> Task:
    return Task(
        description=(
            f"Develop a litigation strategy for the following under {jurisdiction} law:\n\n"
            f"Query: {query}\n"
            f"Matter Facts: {matter_facts or 'Not specified'}\n\n"
            f"Provide:\n"
            f"1. Three settlement strategy options with expected value calculations\n"
            f"2. Litigation timeline with key deadlines\n"
            f"3. Budget projection\n"
            f"4. Venue/forum selection analysis (if multi-state)\n"
            f"5. Proactive 'what am I missing?' checklist\n"
            f"6. Recommended next 3 actions"
        ),
        agent=agent,
        expected_output=(
            "Strategic plan with: settlement options (3 scenarios with $$ ranges), "
            "timeline table, budget projection, venue analysis, proactive checklist, "
            "and prioritized next actions."
        ),
    )


# ── Intent Classification ─────────────────────────────────────────

def classify_intent(message: str) -> str:
    """Classify user message to route to the right agent."""
    msg = message.lower()
    scores = {"researcher": 0, "analyst": 0, "drafter": 0, "strategist": 0}

    # Researcher signals
    research_kw = ["research", "case law", "precedent", "statute", "find", "search",
                   "cite", "citation", "authority", "holding", "ruling", "sol",
                   "limitation", "rule", "regulation", "code", "preemption"]
    for k in research_kw:
        if k in msg:
            scores["researcher"] += 3
    if any(p in msg for p in ["k.s.a", "ksa ", "kansas statute", "chapter 60", "10th circuit"]):
        scores["researcher"] += 6
    if any(p in msg for p in ["rsmo", "r.s.mo", "missouri statute", "missouri supreme court rule", "8th circuit"]):
        scores["researcher"] += 6

    # Drafter signals
    draft_kw = ["draft", "write", "prepare", "create", "generate", "motion", "complaint",
                "letter", "brief", "contract", "agreement", "petition", "template",
                "engagement", "demand", "discovery request"]
    for k in draft_kw:
        if k in msg:
            scores["drafter"] += 3
    if "draft a" in msg or "draft the" in msg or "draft my" in msg:
        scores["drafter"] += 5
    if "motion to" in msg:
        scores["drafter"] += 6

    # Analyst signals
    analyst_kw = ["risk", "assess", "evaluat", "analyz", "review", "strength", "weakness",
                  "exposure", "damage", "inconsisten", "deposition", "enforceab", "score",
                  "audit", "calculate", "comparative fault"]
    for k in analyst_kw:
        if k in msg:
            scores["analyst"] += 3
    if "risk assess" in msg:
        scores["analyst"] += 5
    if "what am i missing" in msg:
        scores["analyst"] += 4

    # Strategist signals
    strategist_kw = ["strateg", "settle", "settlement", "timeline", "calendar", "deadline",
                     "budget", "scenario", "option", "plan", "mediat", "arbitrat", "trial",
                     "recommend", "proactive", "missing", "next step", "appeal"]
    for k in strategist_kw:
        if k in msg:
            scores["strategist"] += 3
    if "what am i missing" in msg:
        scores["strategist"] += 5

    # Find winner
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "strategist"


# ── Crew Execution ────────────────────────────────────────────────

def run_single_agent(
    query: str,
    jurisdiction: str = "missouri",
    agent_type: str = "",
    matter_facts: str = "",
    document_type: str = "",
) -> dict:
    """Run a single agent task and return structured results."""
    try:
        llm = create_llm()
        agents = create_agents(llm)

        # Auto-classify if no agent specified
        if not agent_type:
            agent_type = classify_intent(query)

        agent = agents[agent_type]

        # Create task
        jx_display = {
            "kansas": "Kansas",
            "missouri": "Missouri",
            "federal": "Federal",
            "multistate": "Kansas & Missouri",
        }.get(jurisdiction.lower(), jurisdiction)

        if agent_type == "researcher":
            task = create_research_task(agent, query, jx_display)
        elif agent_type == "analyst":
            task = create_analysis_task(agent, query, jx_display, matter_facts)
        elif agent_type == "drafter":
            task = create_drafting_task(agent, query, jx_display, document_type, matter_facts)
        elif agent_type == "strategist":
            task = create_strategy_task(agent, query, jx_display, matter_facts)
        else:
            task = create_research_task(agent, query, jx_display)

        # Run single-agent crew
        crew = Crew(
            agents=[agent],
            tasks=[task],
            process=Process.sequential,
            verbose=False,
        )

        result = crew.kickoff()

        return {
            "success": True,
            "agent_type": agent_type,
            "content": str(result),
            "jurisdiction": jurisdiction,
            "model": get_llm_config()["model"],
            "token_usage": getattr(result, "token_usage", {}),
        }

    except Exception as e:
        return {
            "success": False,
            "agent_type": agent_type or "unknown",
            "error": str(e),
            "content": "",
            "jurisdiction": jurisdiction,
        }


def run_full_crew(
    query: str,
    jurisdiction: str = "missouri",
    matter_facts: str = "",
    document_type: str = "",
) -> dict:
    """Run the full hierarchical crew (all 4 agents)."""
    try:
        llm = create_llm()
        agents = create_agents(llm)

        jx_display = {
            "kansas": "Kansas",
            "missouri": "Missouri",
            "federal": "Federal",
            "multistate": "Kansas & Missouri",
        }.get(jurisdiction.lower(), jurisdiction)

        tasks = [
            create_research_task(agents["researcher"], query, jx_display),
            create_analysis_task(agents["analyst"], query, jx_display, matter_facts),
        ]

        # Conditionally add drafter if document type is implied
        if document_type or any(kw in query.lower() for kw in ["draft", "write", "prepare", "motion", "complaint", "letter"]):
            tasks.append(create_drafting_task(
                agents["drafter"], query, jx_display, document_type, matter_facts
            ))

        tasks.append(create_strategy_task(agents["strategist"], query, jx_display, matter_facts))

        crew = Crew(
            agents=list(agents.values()),
            tasks=tasks,
            process=Process.sequential,  # sequential for reliability
            verbose=False,
        )

        result = crew.kickoff()

        return {
            "success": True,
            "agent_type": "full_crew",
            "content": str(result),
            "jurisdiction": jurisdiction,
            "model": get_llm_config()["model"],
            "agents_used": list(agents.keys()),
            "tasks_completed": len(tasks),
            "token_usage": getattr(result, "token_usage", {}),
        }

    except Exception as e:
        return {
            "success": False,
            "agent_type": "full_crew",
            "error": str(e),
            "content": "",
            "jurisdiction": jurisdiction,
        }
