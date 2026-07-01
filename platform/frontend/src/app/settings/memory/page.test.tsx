"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MemorySettingsPage from "./page";

const mockUseHasPermissions = vi.fn();
const mockUseMemories = vi.fn();
const mockUseMyTeams = vi.fn();
const mockUseTeams = vi.fn();
const mockUseFeature = vi.fn();
const mockUseOrganization = vi.fn();
const mockUseUpdateMemorySettings = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/memory",
}));

vi.mock("@/lib/auth/auth.query", () => ({
  useHasPermissions: (params: Record<string, string[]>) =>
    mockUseHasPermissions(params),
}));

vi.mock("@/lib/config/config.query", () => ({
  useFeature: (flag: string) => mockUseFeature(flag),
}));

vi.mock("@/lib/organization.query", () => ({
  useOrganization: () => mockUseOrganization(),
  useUpdateMemorySettings: () => mockUseUpdateMemorySettings(),
}));

vi.mock("@/lib/memory.query", () => ({
  useMemories: (visibility: string) => mockUseMemories(visibility),
  useCreateMemory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMemory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteMemory: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/teams/team.query", () => ({
  useMyTeams: (opts?: { enabled?: boolean }) => mockUseMyTeams(opts),
  useTeams: (opts?: { enabled?: boolean }) => mockUseTeams(opts),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemorySettingsPage />
    </QueryClientProvider>,
  );
}

function permissionMap(
  permissions: Record<string, string[]>,
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const [resource, actions] of Object.entries(permissions)) {
    for (const action of actions) {
      result[`${resource}:${action}`] = true;
    }
  }
  return result;
}

describe("MemorySettingsPage", () => {
  beforeEach(() => {
    mockUseMemories.mockReturnValue({ data: [], isPending: false });
    mockUseMyTeams.mockReturnValue({ data: [] });
    mockUseTeams.mockReturnValue({ data: [] });
    mockUseFeature.mockImplementation((flag: string) =>
      flag === "memoryEnabled" ? true : undefined,
    );
    mockUseOrganization.mockReturnValue({
      data: { memoryEnabled: true },
    });
    mockUseUpdateMemorySettings.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    mockUseHasPermissions.mockImplementation(
      (params: Record<string, string[]>) => {
        const granted = permissionMap({ memory: ["read"] });
        const resource = Object.keys(params)[0];
        const action = params[resource]?.[0];
        return {
          data: !!granted[`${resource}:${action}`],
          isPending: false,
        };
      },
    );
  });

  it("shows access denied when the user lacks memory:read", () => {
    mockUseHasPermissions.mockImplementation(() => ({
      data: false,
      isPending: false,
    }));

    renderPage();

    expect(screen.getByText("Access denied")).toBeInTheDocument();
    expect(
      screen.getByText("You do not have permission to view memory settings."),
    ).toBeInTheDocument();
  });

  it("hides row-level write controls for read-only users", () => {
    mockUseMemories.mockReturnValue({
      data: [
        {
          id: "mem-1",
          content: "existing fact",
          tier: "core",
          visibility: "personal",
          userId: "user-1",
          teamId: null,
          organizationId: "org-1",
          createdBy: "user-1",
          taintedAtWrite: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      isPending: false,
    });

    renderPage();

    expect(screen.getByText("existing fact")).toBeInTheDocument();
    expect(screen.queryByText("Actions")).toBeNull();
    expect(screen.queryByLabelText("Edit memory")).toBeNull();
    expect(screen.queryByLabelText("Delete memory")).toBeNull();
  });

  it("shows add controls when the user can create personal memories", () => {
    mockUseHasPermissions.mockImplementation(
      (params: Record<string, string[]>) => {
        const granted = permissionMap({
          memory: ["read", "create", "update", "delete"],
        });
        const resource = Object.keys(params)[0];
        const action = params[resource]?.[0];
        return {
          data: !!granted[`${resource}:${action}`],
          isPending: false,
        };
      },
    );

    renderPage();

    expect(screen.getByRole("button", { name: /^add$/i })).toBeInTheDocument();
  });

  it("shows enable CTA for memory admins when org memory is disabled", () => {
    mockUseOrganization.mockReturnValue({
      data: { memoryEnabled: false },
    });
    mockUseHasPermissions.mockImplementation(
      (params: Record<string, string[]>) => {
        const granted = permissionMap({ memory: ["read", "admin"] });
        const resource = Object.keys(params)[0];
        const action = params[resource]?.[0];
        return {
          data: !!granted[`${resource}:${action}`],
          isPending: false,
        };
      },
    );

    renderPage();

    expect(
      screen.getByRole("button", { name: /enable durable memory/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Personal" })).toBeNull();
  });

  it("shows deployment unavailable message when memory is globally disabled", () => {
    mockUseFeature.mockImplementation((flag: string) =>
      flag === "memoryEnabled" ? false : undefined,
    );

    renderPage();

    expect(screen.getByText("Not available")).toBeInTheDocument();
  });
});
