import { archestraApiClient } from "@archestra/shared";
import {
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { handleApiError } from "./utils";

export const mailSettingsKeys = {
  all: ["mail-settings"] as const,
  settings: () => [...mailSettingsKeys.all, "settings"] as const,
  status: () => [...mailSettingsKeys.all, "status"] as const,
};

export type MailTlsMode = "none" | "starttls" | "tls";
export type MailProvider = "log" | "smtp";

export type MailSettings = {
  provider: MailProvider;
  fromAddress: string | null;
  fromName: string | null;
  replyTo: string | null;
  smtp: {
    host: string | null;
    port: number | null;
    tlsMode: MailTlsMode;
    username: string | null;
    passwordConfigured: boolean;
  } | null;
  verifiedAt: string | null;
  overriddenByEnv: boolean;
};

export type MailStatus = {
  configured: boolean;
  verified: boolean;
  overriddenByEnv: boolean;
};

export type UpdateMailSettingsBody =
  | {
      provider: "smtp";
      fromAddress: string;
      fromName?: string;
      replyTo?: string;
      smtp: {
        host: string;
        port: number;
        tlsMode: MailTlsMode;
        username?: string;
        password?: string;
      };
    }
  | {
      provider: "log";
      fromAddress?: string;
      fromName?: string;
      replyTo?: string;
    };

type TestMailResult = {
  success: boolean;
  error?: string;
  durationMs: number;
};

export function useMailSettings(
  options?: Pick<
    UseQueryOptions<MailSettings>,
    "enabled" | "staleTime" | "refetchOnWindowFocus"
  >,
) {
  return useQuery({
    queryKey: mailSettingsKeys.settings(),
    queryFn: async () => {
      const { data, error } = await archestraApiClient.get<MailSettings>({
        url: "/api/mail/settings",
      });
      if (error) {
        handleApiError(error);
        throw error;
      }
      return data as unknown as MailSettings;
    },
    staleTime: 30_000,
    ...options,
  });
}

export function useMailStatus(
  options?: Pick<
    UseQueryOptions<MailStatus>,
    "enabled" | "staleTime" | "refetchOnWindowFocus"
  >,
) {
  return useQuery({
    queryKey: mailSettingsKeys.status(),
    queryFn: async () => {
      const { data, error } = await archestraApiClient.get<MailStatus>({
        url: "/api/mail/status",
      });
      if (error) {
        return {
          configured: true,
          verified: false,
          overriddenByEnv: false,
        } satisfies MailStatus;
      }
      return data as unknown as MailStatus;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    ...options,
  });
}

export function useUpdateMailSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateMailSettingsBody) => {
      const { data, error } = await archestraApiClient.put<MailSettings>({
        url: "/api/mail/settings",
        body,
      });
      if (error) {
        handleApiError(error);
        return null;
      }
      return data as unknown as MailSettings;
    },
    onSuccess: (settings) => {
      if (!settings) return;
      queryClient.setQueryData(mailSettingsKeys.settings(), settings);
      queryClient.invalidateQueries({ queryKey: mailSettingsKeys.status() });
      toast.success("Mail settings saved");
    },
  });
}

export function useTestMailSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body?: { to?: string }) => {
      const { data, error } = await archestraApiClient.post<TestMailResult>({
        url: "/api/mail/test",
        body: body ?? {},
      });
      if (error) {
        handleApiError(error);
        return null;
      }
      return data as unknown as TestMailResult;
    },
    onSuccess: (result) => {
      if (!result) return;
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: mailSettingsKeys.settings() });
        queryClient.invalidateQueries({ queryKey: mailSettingsKeys.status() });
        toast.success("Test email sent");
      } else {
        toast.error(result.error ?? "Failed to send test email");
      }
    },
  });
}
