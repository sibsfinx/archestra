"use client";

import {
  Archive,
  Brain,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { FormDialog } from "@/components/form-dialog";
import { LoadingSpinner, LoadingWrapper } from "@/components/loading";
import { SearchInput } from "@/components/search-input";
import { TableRowActions } from "@/components/table-row-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogForm, DialogStickyFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useHasPermissions } from "@/lib/auth/auth.query";
import { useFeature } from "@/lib/config/config.query";
import {
  type MemoryEntry,
  type MemoryTier,
  type MemoryVisibility,
  useCreateMemory,
  useDeleteMemory,
  useMemories,
  useUpdateMemory,
} from "@/lib/memory.query";
import {
  useOrganization,
  useUpdateMemorySettings,
} from "@/lib/organization.query";
import { useMyTeams, useTeams } from "@/lib/teams/team.query";
import { formatRelativeTimeFromNow } from "@/lib/utils/date-time";
import {
  browseMemories,
  CORE_CAP_PER_SCOPE,
  MEMORY_INJECTION_TOTAL_CAP,
  MEMORY_PAGE_SIZE,
  type MemoryTierFilter,
} from "./memory-page-utils";

type MemoryTab = MemoryVisibility;

const MEMORY_CAP_HELP =
  `Store up to ${CORE_CAP_PER_SCOPE} core memories per scope. ` +
  `Agents inject up to ${MEMORY_INJECTION_TOTAL_CAP} core memories total across personal, team, and org scopes. ` +
  "Archival memories stay searchable in settings but are not injected.";

function tierLabel(tier: MemoryTier): string {
  return tier === "core" ? "Core" : "Archival";
}

function MemoryDisabledEmptyState() {
  const enableMemory = useUpdateMemorySettings(
    "Durable memory enabled",
    "Failed to enable durable memory",
  );

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border bg-background shadow-sm">
          <Brain className="h-7 w-7 text-primary" />
        </div>
        <h2 className="mb-2 text-xl font-semibold">Durable memory is off</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Enable durable memory so agents can recall personal, team, and
          organization facts across conversations.
        </p>
        <Button
          onClick={() => enableMemory.mutate({ memoryEnabled: true })}
          disabled={enableMemory.isPending}
        >
          {enableMemory.isPending ? "Enabling…" : "Enable durable memory"}
        </Button>
      </div>
    </div>
  );
}

function MemoryOrgAdminBanner() {
  const disableMemory = useUpdateMemorySettings(
    "Durable memory disabled",
    "Failed to disable durable memory",
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <Alert>
        <AlertTitle>Organization admin</AlertTitle>
        <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Durable memory is enabled for this organization. Disabling it blocks
            recall and settings access for non-admins until re-enabled.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setConfirmOpen(true)}
            disabled={disableMemory.isPending}
          >
            Disable durable memory
          </Button>
        </AlertDescription>
      </Alert>

      <DeleteConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Disable durable memory?"
        description="Agents will stop injecting memories and most users lose access to memory settings until an admin re-enables it."
        isPending={disableMemory.isPending}
        onConfirm={() => {
          disableMemory.mutate({ memoryEnabled: false });
          setConfirmOpen(false);
        }}
        confirmLabel="Disable"
        pendingLabel="Disabling..."
      />
    </>
  );
}

function MemoryBrowseToolbar({
  searchTerm,
  onSearchChange,
  tierFilter,
  onTierFilterChange,
  coreCount,
}: {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  tierFilter: MemoryTierFilter;
  onTierFilterChange: (value: MemoryTierFilter) => void;
  coreCount: number;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          placeholder="Search facts..."
          syncQueryParams={false}
          value={searchTerm}
          onSearchChange={onSearchChange}
          className="w-full sm:max-w-sm"
        />
        <Select
          value={tierFilter}
          onValueChange={(value) =>
            onTierFilterChange(value as MemoryTierFilter)
          }
        >
          <SelectTrigger
            className="w-full sm:w-[160px]"
            aria-label="Tier filter"
          >
            <SelectValue placeholder="All tiers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers</SelectItem>
            <SelectItem value="core">Core only</SelectItem>
            <SelectItem value="archival">Archival only</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Badge variant="secondary" className="w-fit">
        Core {coreCount}/{CORE_CAP_PER_SCOPE}
      </Badge>
    </div>
  );
}

function MemoryTierSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: MemoryTier;
  onChange: (tier: MemoryTier) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Tier</Label>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as MemoryTier)}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="core">Core — injected into prompts</SelectItem>
          <SelectItem value="archival">
            Archival — stored only, not injected
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function useMemoryWriteAccess(params: {
  visibility: MemoryTab;
  teamId: string | null;
}) {
  const { visibility, teamId } = params;
  const { data: isMemoryAdmin } = useHasPermissions({ memory: ["admin"] });
  const { data: isMemoryTeamAdmin } = useHasPermissions({
    memory: ["team-admin"],
  });
  const { data: canCreate } = useHasPermissions({ memory: ["create"] });
  const { data: canUpdate } = useHasPermissions({ memory: ["update"] });
  const { data: canDelete } = useHasPermissions({ memory: ["delete"] });
  const { data: myTeams = [] } = useMyTeams({
    enabled: visibility === "team",
  });

  return useMemo(() => {
    if (visibility === "personal") {
      return {
        canCreate: !!canCreate,
        canUpdate: !!canUpdate,
        canDelete: !!canDelete,
      };
    }

    if (visibility === "team") {
      const isMember = teamId
        ? myTeams.some((team) => team.id === teamId)
        : false;
      const canManage = !!isMemoryAdmin || (!!isMemoryTeamAdmin && isMember);
      return {
        canCreate: canManage,
        canUpdate: canManage,
        canDelete: canManage,
      };
    }

    return {
      canCreate: !!isMemoryAdmin,
      canUpdate: !!isMemoryAdmin,
      canDelete: !!isMemoryAdmin,
    };
  }, [
    canCreate,
    canDelete,
    canUpdate,
    isMemoryAdmin,
    isMemoryTeamAdmin,
    myTeams,
    teamId,
    visibility,
  ]);
}

function MemoryScopePanel({
  visibility,
  teamId,
  onTeamIdChange,
  memoryOrgEnabled,
}: {
  visibility: MemoryTab;
  teamId: string | null;
  onTeamIdChange: (teamId: string | null) => void;
  memoryOrgEnabled: boolean;
}) {
  const { data: canReadMemories, isPending: isCheckingPermissions } =
    useHasPermissions({ memory: ["read"] });
  const { data: isMemoryAdmin } = useHasPermissions({ memory: ["admin"] });
  const { data: memories = [], isPending } = useMemories(visibility, {
    enabled: memoryOrgEnabled,
  });
  const { data: myTeams = [] } = useMyTeams({
    enabled: visibility === "team" && !isMemoryAdmin,
  });
  const { data: allTeams = [] } = useTeams({
    enabled: visibility === "team" && !!isMemoryAdmin,
  });
  const teams = isMemoryAdmin ? allTeams : myTeams;
  const writeAccess = useMemoryWriteAccess({ visibility, teamId });
  const createMemory = useCreateMemory();
  const updateMemory = useUpdateMemory();
  const deleteMemory = useDeleteMemory();

  const [newContent, setNewContent] = useState("");
  const [newTier, setNewTier] = useState<MemoryTier>("core");
  const [searchTerm, setSearchTerm] = useState("");
  const [tierFilter, setTierFilter] = useState<MemoryTierFilter>("all");
  const [page, setPage] = useState(1);
  const [memoryToDelete, setMemoryToDelete] = useState<MemoryEntry | null>(
    null,
  );
  const [memoryToEdit, setMemoryToEdit] = useState<MemoryEntry | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTier, setEditTier] = useState<MemoryTier>("core");

  const teamNameById = useMemo(
    () => new Map(teams.map((team) => [team.id, team.name])),
    [teams],
  );

  const browse = useMemo(
    () =>
      browseMemories({
        memories,
        teamId: visibility === "team" ? teamId : null,
        tierFilter,
        searchTerm,
        page,
      }),
    [memories, page, searchTerm, teamId, tierFilter, visibility],
  );

  useEffect(() => {
    if (page > browse.totalPages) {
      setPage(browse.totalPages);
    }
  }, [browse.totalPages, page]);

  useEffect(() => {
    if (visibility !== "team" || teams.length === 0) return;
    if (teamId && teams.some((team) => team.id === teamId)) return;
    onTeamIdChange(teams[0]?.id ?? null);
    setPage(1);
  }, [onTeamIdChange, teamId, teams, visibility]);

  const handleCreate = async () => {
    const content = newContent.trim();
    if (!content || !writeAccess.canCreate) return;
    if (visibility === "team" && !teamId) return;

    await createMemory.mutateAsync({
      content,
      visibility,
      tier: newTier,
      ...(visibility === "team" && teamId ? { teamId } : {}),
    });
    setNewContent("");
    setNewTier("core");
  };

  const handleUpdate = async () => {
    if (!memoryToEdit) return;
    const content = editContent.trim();
    if (!content) return;

    await updateMemory.mutateAsync({
      id: memoryToEdit.id,
      visibility,
      content,
      tier: editTier,
    });
    setMemoryToEdit(null);
    setEditContent("");
    setEditTier("core");
  };

  const handleTierToggle = async (memory: MemoryEntry) => {
    const nextTier: MemoryTier = memory.tier === "core" ? "archival" : "core";
    await updateMemory.mutateAsync({
      id: memory.id,
      visibility,
      tier: nextTier,
    });
  };

  const handleDelete = async () => {
    if (!memoryToDelete) return;
    await deleteMemory.mutateAsync({
      id: memoryToDelete.id,
      visibility,
    });
    setMemoryToDelete(null);
  };

  const showTeamColumn = visibility === "team" && teams.length > 1;
  const showActions = writeAccess.canUpdate || writeAccess.canDelete;
  const emptyColSpan = 3 + (showTeamColumn ? 1 : 0) + (showActions ? 1 : 0);

  if (!isCheckingPermissions && !canReadMemories) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Access denied</AlertTitle>
        <AlertDescription>
          You do not have permission to view memory settings.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{MEMORY_CAP_HELP}</p>

      {visibility === "team" && teams.length > 1 && (
        <div className="space-y-2">
          <Label htmlFor="memory-team">Team</Label>
          <Select
            value={teamId ?? undefined}
            onValueChange={(value) => {
              onTeamIdChange(value);
              setPage(1);
            }}
          >
            <SelectTrigger id="memory-team" className="w-full max-w-sm">
              <SelectValue placeholder="Select a team" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {visibility === "team" && teams.length === 0 && (
        <Alert>
          <AlertTitle>No teams</AlertTitle>
          <AlertDescription>
            Team memories appear here once you belong to a team.
          </AlertDescription>
        </Alert>
      )}

      {!writeAccess.canCreate &&
        (visibility === "team" || visibility === "org") && (
          <Alert>
            <AlertTitle>Read only</AlertTitle>
            <AlertDescription>
              {visibility === "team"
                ? "Only team admins can add or edit team memories for teams they belong to."
                : "Only organization admins can add or edit organization memories."}
            </AlertDescription>
          </Alert>
        )}

      <MemoryBrowseToolbar
        searchTerm={searchTerm}
        onSearchChange={(value) => {
          setSearchTerm(value);
          setPage(1);
        }}
        tierFilter={tierFilter}
        onTierFilterChange={(value) => {
          setTierFilter(value);
          setPage(1);
        }}
        coreCount={browse.coreCount}
      />

      {writeAccess.canCreate && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex gap-2">
            <Input
              value={newContent}
              onChange={(event) => setNewContent(event.target.value)}
              placeholder="Add a memory fact..."
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCreate();
                }
              }}
            />
            <Button
              type="button"
              onClick={() => void handleCreate()}
              disabled={
                createMemory.isPending ||
                !newContent.trim() ||
                (visibility === "team" && !teamId)
              }
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
          <MemoryTierSelect
            id="new-memory-tier"
            value={newTier}
            onChange={setNewTier}
          />
        </div>
      )}

      <LoadingWrapper
        isPending={isPending}
        loadingFallback={<LoadingSpinner />}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fact</TableHead>
              <TableHead className="w-[100px]">Tier</TableHead>
              {showTeamColumn && <TableHead>Team</TableHead>}
              <TableHead>Updated</TableHead>
              {showActions && (
                <TableHead className="w-[100px]">Actions</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {browse.pageItems.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={emptyColSpan}
                  className="text-muted-foreground"
                >
                  {browse.browsed.length === 0 && memories.length > 0
                    ? "No memories match your filters"
                    : "No memories yet"}
                </TableCell>
              </TableRow>
            ) : (
              browse.pageItems.map((memory) => (
                <TableRow key={memory.id}>
                  <TableCell className="whitespace-normal">
                    {memory.content}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={memory.tier === "core" ? "default" : "secondary"}
                    >
                      {tierLabel(memory.tier)}
                    </Badge>
                  </TableCell>
                  {showTeamColumn && (
                    <TableCell>
                      {memory.teamId
                        ? (teamNameById.get(memory.teamId) ?? "Unknown team")
                        : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTimeFromNow(memory.updatedAt)}
                  </TableCell>
                  {showActions && (
                    <TableCell>
                      <TableRowActions
                        actions={[
                          ...(writeAccess.canUpdate
                            ? [
                                {
                                  icon: <Pencil className="h-4 w-4" />,
                                  label: "Edit memory",
                                  onClick: () => {
                                    setMemoryToEdit(memory);
                                    setEditContent(memory.content);
                                    setEditTier(memory.tier);
                                  },
                                },
                              ]
                            : []),
                          ...(writeAccess.canDelete
                            ? [
                                {
                                  icon: <Trash2 className="h-4 w-4" />,
                                  label: "Delete memory",
                                  onClick: () => setMemoryToDelete(memory),
                                  variant: "destructive" as const,
                                },
                              ]
                            : []),
                        ]}
                        dropdownActions={
                          writeAccess.canUpdate
                            ? [
                                memory.tier === "core"
                                  ? {
                                      icon: <Archive className="h-4 w-4" />,
                                      label: "Archive",
                                      onClick: () =>
                                        void handleTierToggle(memory),
                                    }
                                  : {
                                      icon: <Star className="h-4 w-4" />,
                                      label: "Make core",
                                      onClick: () =>
                                        void handleTierToggle(memory),
                                    },
                              ]
                            : undefined
                        }
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </LoadingWrapper>

      {browse.browsed.length > MEMORY_PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {browse.pageCount} of {browse.totalPages} (
            {browse.browsed.length} facts)
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={browse.pageCount <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={browse.pageCount >= browse.totalPages}
              onClick={() =>
                setPage((current) => Math.min(browse.totalPages, current + 1))
              }
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <FormDialog
        open={!!memoryToEdit}
        onOpenChange={(open) => {
          if (!open) {
            setMemoryToEdit(null);
            setEditContent("");
            setEditTier("core");
          }
        }}
        title="Edit memory"
        description="Update the fact stored for this scope."
        size="medium"
        className="sm:max-w-lg"
      >
        <DialogForm
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void handleUpdate();
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-memory-content">Fact</Label>
              <Textarea
                id="edit-memory-content"
                value={editContent}
                onChange={(event) => setEditContent(event.target.value)}
                rows={4}
              />
            </div>
            <MemoryTierSelect
              id="edit-memory-tier"
              value={editTier}
              onChange={setEditTier}
            />
          </div>
          <DialogStickyFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMemoryToEdit(null);
                setEditContent("");
                setEditTier("core");
              }}
              disabled={updateMemory.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateMemory.isPending || !editContent.trim()}
            >
              Save
            </Button>
          </DialogStickyFooter>
        </DialogForm>
      </FormDialog>

      <DeleteConfirmDialog
        open={!!memoryToDelete}
        onOpenChange={(open) => !open && setMemoryToDelete(null)}
        title="Delete memory"
        description="This fact will be removed from agent context for this scope."
        isPending={deleteMemory.isPending}
        onConfirm={handleDelete}
        confirmLabel="Delete"
        pendingLabel="Deleting..."
      />
    </div>
  );
}

export default function MemorySettingsPage() {
  const [activeTab, setActiveTab] = useState<MemoryTab>("personal");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const memoryGloballyEnabled = useFeature("memoryEnabled") ?? true;
  const { data: organization, isPending: isOrganizationPending } =
    useOrganization();
  const { data: isMemoryAdmin, isPending: isCheckingMemoryAdmin } =
    useHasPermissions({ memory: ["admin"] });
  const { data: canReadMemories, isPending: isCheckingRead } =
    useHasPermissions({ memory: ["read"] });

  if (!memoryGloballyEnabled) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Not available</AlertTitle>
        <AlertDescription>
          Durable memory is not enabled on this deployment.
        </AlertDescription>
      </Alert>
    );
  }

  if (isCheckingMemoryAdmin || isCheckingRead || isOrganizationPending) {
    return <LoadingSpinner />;
  }

  if (!canReadMemories && !isMemoryAdmin) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Access denied</AlertTitle>
        <AlertDescription>
          You do not have permission to view memory settings.
        </AlertDescription>
      </Alert>
    );
  }

  const memoryOrgEnabled = organization?.memoryEnabled !== false;

  if (!memoryOrgEnabled) {
    if (!isMemoryAdmin) {
      return (
        <Alert variant="destructive">
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>
            Durable memory is disabled for this organization.
          </AlertDescription>
        </Alert>
      );
    }
    return <MemoryDisabledEmptyState />;
  }

  return (
    <div className="space-y-6">
      {isMemoryAdmin && <MemoryOrgAdminBanner />}

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as MemoryTab)}
        className="space-y-6"
      >
        <TabsList>
          <TabsTrigger value="personal">Personal</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="org">Org</TabsTrigger>
        </TabsList>

        <TabsContent value="personal">
          <MemoryScopePanel
            visibility="personal"
            teamId={null}
            onTeamIdChange={() => {}}
            memoryOrgEnabled={memoryOrgEnabled}
          />
        </TabsContent>

        <TabsContent value="team">
          <MemoryScopePanel
            visibility="team"
            teamId={selectedTeamId}
            onTeamIdChange={setSelectedTeamId}
            memoryOrgEnabled={memoryOrgEnabled}
          />
        </TabsContent>

        <TabsContent value="org">
          <MemoryScopePanel
            visibility="org"
            teamId={null}
            onTeamIdChange={() => {}}
            memoryOrgEnabled={memoryOrgEnabled}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
