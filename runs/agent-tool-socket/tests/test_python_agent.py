import asyncio
from pathlib import Path

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI
from langchain_core.outputs import ChatGeneration, ChatResult

from agent_runtime import AgentEngine, compose_prompt, normalize_content


class ToolCallingModel(BaseChatModel):
    @property
    def _llm_type(self):
        return "test-tool-calling"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        latest = messages[-1]
        if isinstance(latest, HumanMessage) and latest.content == "parallel":
            reply = AIMessage(content="", tool_calls=[
                {"name": "probe", "args": {"label": "a"}, "id": "call-a"},
                {"name": "probe", "args": {"label": "b"}, "id": "call-b"},
            ])
        elif isinstance(latest, HumanMessage) and latest.content == "empty":
            reply = AIMessage(content="", tool_calls=[
                {"name": "ask_world_save", "args": {}, "id": "call-empty"},
            ])
        else:
            count = sum(isinstance(message, HumanMessage) for message in messages)
            reply = AIMessage(content=f"users:{count}")
        return ChatResult(generations=[ChatGeneration(message=reply)])


def test_prompt_and_media_validation():
    assert compose_prompt([" base ", "", "workflow", "user"]) == "base\n\nworkflow\n\nuser"
    assert normalize_content("look", [{"type": "video", "url": "https://example.org/a.mp4"}]) == [
        {"type": "text", "text": "look"},
        {"type": "video_url", "video_url": {"url": "https://example.org/a.mp4"}},
    ]
    model = ChatOpenAI(model="qwen/qwen3-vl-30b-a3b-instruct", api_key="test-only",
                       base_url="https://openrouter.ai/api/v1")
    payload = model._get_request_payload([HumanMessage(content=normalize_content(
        "look", [{"type": "video", "url": "https://example.org/a.mp4"}]))])
    assert payload["messages"][0]["content"][1]["type"] == "video_url"
    with pytest.raises(ValueError):
        normalize_content("", [{"type": "unknown", "url": "https://example.org/a"}])


@pytest.mark.asyncio
async def test_create_agent_runs_parallel_graph_tools_and_restores_sqlite(tmp_path: Path):
    events = []
    started = set()
    both_started = asyncio.Event()

    async def graph_tool(name, arguments):
        started.add(arguments["label"])
        if len(started) == 2:
            both_started.set()
        await asyncio.wait_for(both_started.wait(), 2)
        return {"label": arguments["label"]}

    def monitor(event):
        events.append(event)

    options = dict(
        model=ToolCallingModel(), thread_id="thread-a", sqlite_path=tmp_path / "thread.sqlite",
        tools=[{"name": "probe", "description": "Test a graph tool", "parameters": {
            "type": "object", "properties": {"label": {"type": "string"}}, "required": ["label"],
        }}], graph_tool=graph_tool, monitor=monitor,
    )
    async with AgentEngine(**options) as agent:
        first = await agent.invoke("parallel", request_id="request-1", prompts=["base", "workflow"])
    assert first == "users:1"
    assert started == {"a", "b"}
    assert {event["phase"] for event in events} >= {"before_model", "after_model", "before_tool", "after_tool"}
    assert all(event["threadId"] == "thread-a" for event in events)

    async with AgentEngine(**options) as restored:
        second = await restored.invoke("again", request_id="request-2", prompts=["base"])
    assert second == "users:2"


@pytest.mark.asyncio
async def test_zero_argument_graph_tool(tmp_path: Path):
    calls = []

    async def graph_tool(name, arguments):
        calls.append((name, arguments))
        return {"decision": "approve"}

    async with AgentEngine(model=ToolCallingModel(), thread_id="review", sqlite_path=tmp_path / "review.sqlite",
                           tools=[{"name": "ask_world_save", "description": "Ask user", "parameters": {
                               "type": "object", "properties": {},
                           }}], graph_tool=graph_tool, monitor=lambda event: None) as engine:
        answer = await engine.invoke("empty", request_id="review-1", prompts=["ask"])
    assert answer == "users:1"
    assert calls == [("ask_world_save", {})]
