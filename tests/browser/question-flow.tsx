import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QuestionForm } from "../../src/features/sessions/ui/QuestionForm";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import { Button } from "../../src/shared/ui/Button";
import {
  selectedAnswerLabels,
  type UserQuestionPrompt,
  type UserQuestionReply,
} from "../../src/features/sessions/model/userQuestion";
import type { Block } from "../../src/features/sessions/model/session";
import { languageReady, setLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";

// Entirely local fixture. No provider processes, host mutations or network sends.
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", query.get("theme") === "light");
document.body.style.margin = "0";
await setLanguagePreference(query.get("lang") === "tr" ? "tr" : "en");
await languageReady;

const initial: UserQuestionPrompt = {
  requestId: 17,
  providerTurnId: "turn-fixture",
  callId: "question-fixture",
  behavior: "blocking",
  dismissAction: query.get("dismiss") === "decline" ? "decline" : "cancel",
  questions: [
    {
      id: "scope",
      header: "Release scope",
      prompt:
        "Which platforms should this release support? Include any constraints that the implementation must preserve.",
      options:
        query.get("variant") === "choices"
          ? [
              {
                id: "desktop",
                label: "Windows and macOS",
                description: "Focus on the desktop experience.",
              },
              {
                id: "all",
                label: "Desktop and mobile",
                description: "Include the phone experience in this scope.",
              },
            ]
          : [],
      allowCustom: true,
      multiSelect: false,
    },
  ],
};

function Fixture() {
  const [prompt, setPrompt] = useState<UserQuestionPrompt | undefined>(initial);
  const [shown, setShown] = useState(true);
  const [scope, setScope] = useState("fixture-session-a");
  const [reply, setReply] = useState<UserQuestionReply>();
  const [calls, setCalls] = useState(0);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const update = (delivery: UserQuestionPrompt["delivery"]) =>
    setPrompt((current) => current && { ...current, delivery });

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--ui-surface)",
        color: "var(--ui-tone-neutral-fg)",
        fontFamily: "var(--font-sans)",
        padding: "16px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: "56rem", margin: "0 auto", display: "grid", gap: "16px" }}>
        <header
          aria-label="Fixture controls"
          style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}
        >
          <Button onClick={() => setShown((value) => !value)}>
            {shown ? "Hide question" : "Show question"}
          </Button>
          <Button
            onClick={() =>
              setScope((value) => (value.endsWith("a") ? "fixture-session-b" : "fixture-session-a"))
            }
          >
            Switch session
          </Button>
          <Button
            onClick={() =>
              setPrompt(
                (current) =>
                  current && {
                    ...current,
                    behavior: current.behavior === "blocking" ? "nonBlocking" : "blocking",
                  },
              )
            }
          >
            Toggle continuing work
          </Button>
          <Button onClick={() => update("failed")}>Simulate not sent</Button>
          <Button onClick={() => update("unknown")}>Simulate uncertain delivery</Button>
          <Button onClick={() => update("queued")}>Queue answer</Button>
          <Button
            onClick={() => {
              if (!prompt || !reply || reply.kind !== "answered") return;
              const questionAnswers = prompt.questions.map((question) => ({
                prompt: question.prompt,
                answers: selectedAnswerLabels(question, reply),
              }));
              setBlocks([
                {
                  id: "accepted-answer",
                  role: "user",
                  text: questionAnswers
                    .map((answer) => `${answer.prompt}\n${answer.answers.join("\n")}`)
                    .join("\n\n"),
                  questionAnswers,
                },
              ]);
              setPrompt(undefined);
            }}
          >
            Confirm delivery
          </Button>
        </header>
        <output aria-label="Send count">{calls}</output>
        {shown && prompt ? (
          <QuestionForm
            prompt={prompt}
            draftScope={scope}
            onReply={(_, value) => {
              setReply(value);
              setCalls((count) => count + 1);
              update("sending");
            }}
          />
        ) : null}
        <div style={{ height: "360px", display: "flex", minWidth: 0 }}>
          <AgentTranscript blocks={blocks} />
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
