import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { AI_PROVIDERS, getProviderInfo } from "../lib/ai-providers";
import { requireShopSettingsAccess } from "../services/settings-access.server";
import {
  getShopProviderCredentials,
  listShopProviders,
  moveShopProvider,
  removeShopProvider,
  saveShopProvider,
  setShopProviderEnabled,
  testProviderConnection,
} from "../services/ai.providers.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await requireShopSettingsAccess(request);
  return { providers: AI_PROVIDERS, configured: await listShopProviders(shop.id) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const shop = await requireShopSettingsAccess(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const provider = String(formData.get("provider") ?? "");
  const label = getProviderInfo(provider)?.label ?? provider;

  try {
    switch (intent) {
      case "save": {
        await saveShopProvider({
          shopId: shop.id,
          provider,
          model: String(formData.get("model") ?? ""),
          apiKey: String(formData.get("apiKey") ?? "").trim(),
        });
        return { ok: true, message: `${label} saved.` };
      }
      case "test": {
        // Test the key typed into the form, or the stored one when the field is empty.
        const model = String(formData.get("model") ?? "");
        const typedKey = String(formData.get("apiKey") ?? "").trim();
        const stored = typedKey ? null : await getShopProviderCredentials(shop.id, provider);
        const apiKey = typedKey || stored?.apiKey;
        if (!apiKey) return { ok: false, message: `Paste an API key for ${label} first.` };
        const error = await testProviderConnection(provider, model || stored?.model || "", apiKey);
        return error
          ? { ok: false, message: `${label} test failed: ${error}` }
          : { ok: true, message: `${label} works.` };
      }
      case "toggle": {
        const enable = formData.get("enable") === "true";
        await setShopProviderEnabled(shop.id, provider, enable);
        return { ok: true, message: `${label} ${enable ? "enabled" : "disabled"}.` };
      }
      case "move": {
        await moveShopProvider(shop.id, provider, formData.get("direction") === "up" ? "up" : "down");
        return { ok: true, message: "Priority updated." };
      }
      case "remove": {
        await removeShopProvider(shop.id, provider);
        return { ok: true, message: `${label} removed.` };
      }
      default:
        return { ok: false, message: "Unknown action." };
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Something went wrong." };
  }
};

function ProviderForm({ intent, provider, children }: { intent: string; provider: string; children: React.ReactNode }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="provider" value={provider} />
      {children}
    </Form>
  );
}

export default function AiProviderSettingsPage() {
  const { providers, configured } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const isBusy = useNavigation().state !== "idle";

  const byProvider = new Map(configured.map((c) => [c.provider, c]));
  const order = configured.map((c) => c.provider);
  // Configured providers first, in priority order; the rest below.
  const sorted = [
    ...configured.map((c) => providers.find((p) => p.id === c.provider)!).filter(Boolean),
    ...providers.filter((p) => !byProvider.has(p.id)),
  ];

  return (
    <s-page heading="AI providers">
      <s-link slot="breadcrumb-actions" href="/app/settings">Settings</s-link>

      <s-section heading="How it works">
        <s-paragraph>
          Add an API key for each model you want to use. Enabled providers are tried from the top down:
          if the first one fails or is unavailable, the next one answers instead. Keys are stored encrypted
          and are never shown again after saving.
        </s-paragraph>
        {result ? <s-banner tone={result.ok ? "success" : "critical"}>{result.message}</s-banner> : null}
      </s-section>

      {sorted.map((info) => {
        const config = byProvider.get(info.id);
        const position = order.indexOf(info.id);
        return (
          <s-section key={info.id} heading={config ? `${position + 1}. ${info.label}` : info.label}>
            <s-stack gap="base">
              {config ? (
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-badge tone={config.isEnabled ? "success" : "neutral"}>
                    {config.isEnabled ? "Enabled" : "Disabled"}
                  </s-badge>
                  <s-text>Key {config.maskedKey}</s-text>
                </s-stack>
              ) : null}

              <ProviderForm intent="save" provider={info.id}>
                <s-stack gap="base">
                  <s-select label="Model" name="model" value={config?.model ?? info.models[0].id}>
                    {info.models.map((m) => (
                      <s-option key={m.id} value={m.id}>{m.label}</s-option>
                    ))}
                  </s-select>
                  <s-password-field
                    label="API key"
                    name="apiKey"
                    placeholder={config ? "Leave empty to keep the saved key" : "Paste API key"}
                    details={`Get a key at ${info.keyUrl}`}
                  />
                  <s-stack direction="inline" gap="small">
                    <s-button type="submit" variant="primary" disabled={isBusy || undefined}>
                      {config ? "Save" : "Add provider"}
                    </s-button>
                  </s-stack>
                </s-stack>
              </ProviderForm>

              {config ? (
                <s-stack direction="inline" gap="small">
                  <ProviderForm intent="test" provider={info.id}>
                    <input type="hidden" name="model" value={config.model} />
                    <s-button type="submit" disabled={isBusy || undefined}>Test saved key</s-button>
                  </ProviderForm>
                  <ProviderForm intent="move" provider={info.id}>
                    <input type="hidden" name="direction" value="up" />
                    <s-button type="submit" disabled={position === 0 || isBusy || undefined}>Move up</s-button>
                  </ProviderForm>
                  <ProviderForm intent="move" provider={info.id}>
                    <input type="hidden" name="direction" value="down" />
                    <s-button type="submit" disabled={position === order.length - 1 || isBusy || undefined}>
                      Move down
                    </s-button>
                  </ProviderForm>
                  <ProviderForm intent="toggle" provider={info.id}>
                    <input type="hidden" name="enable" value={String(!config.isEnabled)} />
                    <s-button type="submit" disabled={isBusy || undefined}>
                      {config.isEnabled ? "Disable" : "Enable"}
                    </s-button>
                  </ProviderForm>
                  <ProviderForm intent="remove" provider={info.id}>
                    <s-button type="submit" tone="critical" disabled={isBusy || undefined}>Remove</s-button>
                  </ProviderForm>
                </s-stack>
              ) : null}
            </s-stack>
          </s-section>
        );
      })}
    </s-page>
  );
}
