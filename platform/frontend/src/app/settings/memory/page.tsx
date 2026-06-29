"use client";

import { Brain, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { FormDialog } from "@/components/form-dialog";
import { LoadingSpinner, LoadingWrapper } from "@/components/loading";
import { TableRowActions } from "@/components/table-row-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

type MemoryTab = MemoryVisibility;

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
  const [memoryToDelete, setMemoryToDelete] = useState<MemoryEntry | null>(
    null,
  );
  const [memoryToEdit, setMemoryToEdit] = useState<MemoryEntry | null>(null);
  const [editContent, setEditContent] = useState("");

  const teamNameById = useMemo(
    () => new Map(teams.map((team) => [team.id, team.name])),
    [teams],
  );

  const visibleMemories = useMemo(() => {
    if (visibility !== "team" || !teamId) return memories;
    return memories.filter((memory) => memory.teamId === teamId);
  }, [memories, teamId, visibility]);

  useEffect(() => {
    if (visibility !== "team" || teams.length === 0) return;
    if (teamId && teams.some((team) => team.id === teamId)) return;
    onTeamIdChange(teams[0]?.id ?? null);
  }, [onTeamIdChange, teamId, teams, visibility]);

  const handleCreate = async () => {
    const content = newContent.trim();
    if (!content || !writeAccess.canCreate) return;
    if (visibility === "team" && !teamId) return;

    await createMemory.mutateAsync({
      content,
      visibility,
      ...(visibility === "team" && teamId ? { teamId } : {}),
    });
    setNewContent("");
  };

  const handleUpdate = async () => {
    if (!memoryToEdit) return;
    const content = editContent.trim();
    if (!content) return;

    await updateMemory.mutateAsync({
      id: memoryToEdit.id,
      visibility,
      content,
    });
    setMemoryToEdit(null);
    setEditContent("");
  };

  const handleDelete = async () => {
    if (!memoryToDelete) return;
    await deleteMemory.mutateAsync({
      id: memoryToDelete.id,
      visibility,
    });
    setMemoryToDelete(null);
  };

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
      {visibility === "team" && teams.length > 1 && (
        <div className="space-y-2">
          <Label htmlFor="memory-team">Team</Label>
          <Select
            value={teamId ?? undefined}
            onValueChange={(value) => onTeamIdChange(value)}
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

      {writeAccess.canCreate && (
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
      )}

      <LoadingWrapper
        isPending={isPending}
        loadingFallback={<LoadingSpinner />}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fact</TableHead>
              {visibility === "team" && teams.length > 1 && (
                <TableHead>Team</TableHead>
              )}
              <TableHead>Updated</TableHead>
              {(writeAccess.canUpdate || writeAccess.canDelete) && (
                <TableHead className="w-[100px]">Actions</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleMemories.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={
                    2 +
                    (visibility === "team" && teams.length > 1 ? 1 : 0) +
                    (writeAccess.canUpdate || writeAccess.canDelete ? 1 : 0)
                  }
                  className="text-muted-foreground"
                >
                  No memories yet
                </TableCell>
              </TableRow>
            ) : (
              visibleMemories.map((memory) => (
                <TableRow key={memory.id}>
                  <TableCell className="whitespace-normal">
                    {memory.content}
                  </TableCell>
                  {visibility === "team" && teams.length > 1 && (
                    <TableCell>
                      {memory.teamId
                        ? (teamNameById.get(memory.teamId) ?? "Unknown team")
                        : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTimeFromNow(memory.updatedAt)}
                  </TableCell>
                  {(writeAccess.canUpdate || writeAccess.canDelete) && (
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
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </LoadingWrapper>

      <FormDialog
        open={!!memoryToEdit}
        onOpenChange={(open) => {
          if (!open) {
            setMemoryToEdit(null);
            setEditContent("");
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
          </div>
          <DialogStickyFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMemoryToEdit(null);
                setEditContent("");
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
  );
}
