"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/clients/auth/auth-client";

const ForgotPasswordFormSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

type ForgotPasswordFormValues = z.infer<typeof ForgotPasswordFormSchema>;

export function ForgotPasswordView() {
  const [submitted, setSubmitted] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(ForgotPasswordFormSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotPasswordFormValues) {
    setIsPending(true);
    try {
      const { error } = await authClient.requestPasswordReset({
        email: values.email.trim(),
        redirectTo: "/auth/reset-password",
      });

      if (error) {
        toast.error(error.message ?? "Failed to request password reset");
        return;
      }

      setSubmitted(true);
    } finally {
      setIsPending(false);
    }
  }

  if (submitted) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl">Check your email</CardTitle>
          <CardDescription>
            If an account exists for that address, we sent a password reset
            link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/auth/sign-in">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl">Forgot password</CardTitle>
        <CardDescription>
          Enter your email and we will send you a reset link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      disabled={isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send reset link
            </Button>
            <div className="text-center">
              <Link
                href="/auth/sign-in"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Back to sign in
              </Link>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
