import { GoogleAuth } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/firebase.messaging"];

type ServiceAccount = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

function loadServiceAccount(): ServiceAccount {
  const jsonRaw =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    (process.env.FIREBASE_SERVICE_ACCOUNT_B64
      ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, "base64").toString("utf8")
      : undefined);

  if (!jsonRaw) {
    throw new Error(
      "Missing service account. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_B64."
    );
  }

  const parsed: ServiceAccount = JSON.parse(jsonRaw);
  if (parsed.private_key?.includes("\n")) {
    parsed.private_key = parsed.private_key.replace(/\n/g, "\n");
  }
  return parsed;
}

async function getAccessToken(projectIdFromEnv?: string) {
  const credentials = loadServiceAccount();
  const projectId = projectIdFromEnv || credentials.project_id;
  if (!projectId) {
    throw new Error("Missing project_id in service account or env FIREBASE_PROJECT_ID.");
  }

  const auth = new GoogleAuth({
    credentials,
    scopes: SCOPES,
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse || !tokenResponse.token) {
    throw new Error("Unable to acquire FCM access token");
  }

  return { token: tokenResponse.token, projectId };
}

export type SendFcmOptions = {
  token?: string;
  topic?: string;
  notification?: {
    title?: string;
    body?: string;
    image?: string;
  };
  data?: Record<string, string>;
  link?: string; // Optional link to include in data payload
};

export async function sendFcmMessage(options: SendFcmOptions) {
  const { token: accessToken, projectId } = await getAccessToken(process.env.FIREBASE_PROJECT_ID);

  if (!options.token && !options.topic) {
    throw new Error("FCM message requires token or topic");
  }

  const message: Record<string, unknown> = {
    notification: options.notification,
    data: options.data,
  };

  if (options.link) {
    message.data = { ...(message.data || {}), link: options.link };
  }

  if (options.token) {
    message.token = options.token;
  } else if (options.topic) {
    message.topic = options.topic;
  }

  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FCM send failed: ${res.status} ${text}`);
  }

  return res.json();
}

