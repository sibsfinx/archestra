import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authQueryKeys } from "@/lib/auth/auth.query";
import { authClient } from "@/lib/clients/auth/auth-client";

type AuthClientError = {
  message?: string;
  statusText?: string;
};

export type SignInResult =
  | {
      success: true;
      twoFactorRedirect: true;
      redirectUrl: null;
    }
  | {
      success: true;
      twoFactorRedirect?: false;
      redirectUrl: string;
    }
  | {
      success: false;
      showForgotPassword: boolean;
    };

export function useUpdateAccountNameMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await authClient.updateUser({ name });
      if (error) {
        toast.error(getAuthErrorMessage(error, "Failed to update name"));
        return false;
      }
      return true;
    },
    onSuccess: async (updated) => {
      if (!updated) return;
      toast.success("Name updated");
      await queryClient.invalidateQueries({
        queryKey: authQueryKeys.session(),
      });
    },
  });
}

export function useChangeAccountPasswordMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      currentPassword: string;
      newPassword: string;
      revokeOtherSessions?: boolean;
    }) => {
      const { error } = await authClient.changePassword(params);
      if (error) {
        toast.error(
          getChangePasswordErrorMessage(error, "Failed to change password"),
        );
        return false;
      }
      return true;
    },
    onSuccess: async (changed) => {
      if (!changed) return;
      toast.success("Password changed");
      await queryClient.invalidateQueries({
        queryKey: authQueryKeys.defaultCredentialsEnabled(),
      });
    },
  });
}

export function useSignInWithEmailMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      email: string;
      password: string;
      callbackURL?: string;
    }) => {
      const { data, error } = await authClient.signIn.email({
        email: params.email,
        password: params.password,
      });

      if (error) {
        const errorMessage = getAuthErrorMessage(error, "Failed to sign in");
        toast.error(errorMessage);

        return {
          success: false,
          showForgotPassword: isInvalidSignInCredentialsError(errorMessage),
        } satisfies SignInResult;
      }

      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        return {
          success: true,
          twoFactorRedirect: true,
          redirectUrl: null,
        } satisfies SignInResult;
      }

      await queryClient.invalidateQueries({ queryKey: authQueryKeys.all });

      return {
        success: true,
        redirectUrl: data?.url ?? params.callbackURL ?? "/",
      } satisfies SignInResult;
    },
  });
}

function getAuthErrorMessage(error: AuthClientError, fallback: string) {
  return error.message ?? error.statusText ?? fallback;
}

function getChangePasswordErrorMessage(
  error: AuthClientError,
  fallback: string,
) {
  const message = getAuthErrorMessage(error, fallback);
  return message === "Invalid password"
    ? "Current password is invalid"
    : message;
}

function isInvalidSignInCredentialsError(message: string) {
  return (
    message === "Invalid email or password" || message === "Invalid password"
  );
}
