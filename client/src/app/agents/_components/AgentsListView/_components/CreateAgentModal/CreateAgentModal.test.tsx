import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/agents.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const useProviderModels = vi.fn(() => ({
  data: [{ id: "gpt-4.1" }, { id: "gpt-5" }],
}));
vi.mock("@/lib/hooks/agents", () => ({
  useCreateAgent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useProviderModels: () => useProviderModels(),
}));

import { CreateAgentModal } from "./CreateAgentModal";

afterEach(cleanup);

function renderModal() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <CreateAgentModal onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("CreateAgentModal model picker", () => {
  it("offers the provider's models in a dropdown instead of a free-text field", () => {
    renderModal();

    // The default model is the current selection, not a value typed into an input.
    fireEvent.click(screen.getByText("gpt-4.1"));

    expect(screen.getByPlaceholderText("Search models…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "gpt-5" })).toBeInTheDocument();
  });

  it("selects a model from the list", () => {
    renderModal();

    fireEvent.click(screen.getByText("gpt-4.1"));
    fireEvent.click(screen.getByRole("button", { name: "gpt-5" }));

    expect(screen.getByText("gpt-5")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search models…")).not.toBeInTheDocument();
  });

  it("explains an empty model list instead of showing a silent dropdown", () => {
    useProviderModels.mockReturnValueOnce({ data: [] });
    renderModal();

    expect(
      screen.getByText("No models loaded — set the openai API key in Settings → API Keys."),
    ).toBeInTheDocument();
  });
});
