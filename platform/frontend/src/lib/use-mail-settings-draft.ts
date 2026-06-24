"use client";

import { useCallback, useMemo, useState } from "react";
import {
  canSaveDraft,
  draftToUpdateBody,
  type MailDraftState,
  settingsToDraft,
} from "@/lib/mail-settings-form";
import {
  type MailSettings,
  useTestMailSettings,
  useUpdateMailSettings,
} from "@/lib/mail-settings.query";

type UseMailSettingsDraftOptions = {
  settings: MailSettings;
  preset?: "local" | "default";
  onSaved?: (settings: MailSettings) => void;
};

export function useMailSettingsDraft({
  settings,
  preset = "default",
  onSaved,
}: UseMailSettingsDraftOptions) {
  const updateMutation = useUpdateMailSettings();
  const testMutation = useTestMailSettings();

  const baseline = useMemo(
    () => settingsToDraft(settings, { preset }),
    [settings, preset],
  );

  const [draft, setDraft] = useState<MailDraftState | null>(null);
  const [testRecipient, setTestRecipient] = useState<string | null>(null);
  const [showTestRecipient, setShowTestRecipient] = useState(false);

  const effective = draft ?? baseline;
  const hasChanges = draft !== null;
  const canSave = canSaveDraft(effective);

  const updateDraft = useCallback(
    (patch: Partial<MailDraftState>) => {
      setDraft((current) => ({
        ...(current ?? baseline),
        ...patch,
      }));
    },
    [baseline],
  );

  const resetDraft = useCallback(() => setDraft(null), []);

  const handleSave = useCallback(async () => {
    const saved = await updateMutation.mutateAsync(
      draftToUpdateBody(effective),
    );
    if (!saved) return false;
    resetDraft();
    onSaved?.(saved);
    return true;
  }, [effective, onSaved, resetDraft, updateMutation]);

  const handleTest = useCallback(
    async (recipient?: string) => {
      if (!recipient) return false;
      const result = await testMutation.mutateAsync({ to: recipient });
      return Boolean(result?.success);
    },
    [testMutation],
  );

  return {
    effective,
    hasChanges,
    canSave,
    updateDraft,
    resetDraft,
    handleSave,
    handleTest,
    testRecipient,
    setTestRecipient,
    showTestRecipient,
    setShowTestRecipient,
    isSaving: updateMutation.isPending,
    isTesting: testMutation.isPending,
    testDisabled: hasChanges || testMutation.isPending,
  };
}
