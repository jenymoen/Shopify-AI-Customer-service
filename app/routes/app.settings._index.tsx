import type { LoaderFunctionArgs } from "react-router";
import { requireShopSettingsAccess } from "../services/settings-access.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireShopSettingsAccess(request);
  return null;
};

export default function SettingsIndexPage() {
  return (
    <s-page heading="Settings">
      <s-section heading="Email">
        <s-paragraph>Support email address, sender name and where to forward inbound email.</s-paragraph>
        <s-link href="/app/settings/email">Open email settings</s-link>
      </s-section>

      <s-section heading="AI providers">
        <s-paragraph>
          Choose AI models, paste API keys and set the order they are tried in. If the first provider fails, the next one is used.
        </s-paragraph>
        <s-link href="/app/settings/ai">Open AI provider settings</s-link>
      </s-section>
    </s-page>
  );
}
