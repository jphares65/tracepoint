import "server-only";

import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { getPostgresPool } from "@/lib/database/postgres-pool";
import { getCognitoAdminDirectory } from "@/lib/authentication/cognito-admin";
import {
  createEmailProvider,
  EmailProviderConfigurationError,
  EmailProviderResponseError,
} from "@/lib/email/provider";

export const ACTIVATION_VALID_DAYS = 14;

type ActivationRow = {
  id: string;
  department_id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_by_user_id: string | null;
  created_at: string;
  used_at: string | null;
  revoked_at: string | null;
};
type AwsActivationRow=ActivationRow&{email:string;full_name:string;provider_username:string;provider_subject:string;identity_state:string;membership_active:boolean;activation_status:string};
const awsNative=()=>process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE==="aws-native"&&process.env.TRACEPOINT_DATA_PROVIDER==="postgres"&&process.env.TRACEPOINT_AUTH_PROVIDER==="cognito";

type IssueActivationInput = {
  departmentId: string;
  userId: string;
  email: string;
  fullName: string;
  siteUrl: string;
  actorUserId: string;
};

function hashTokenSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function parseToken(value: string) {
  const token = value.trim();
  const separator = token.indexOf(".");

  if (separator <= 0) {
    throw new Error("This activation link is invalid.");
  }

  const tokenId = token.slice(0, separator);
  const secret = token.slice(separator + 1);

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      tokenId,
    ) ||
    !/^[A-Za-z0-9_-]{40,}$/.test(secret)
  ) {
    throw new Error("This activation link is invalid.");
  }

  return { tokenId, secret };
}

function secureHashMatches(expectedHash: string, secret: string) {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(hashTokenSecret(secret), "hex");

  return (
    expected.length === actual.length &&
    timingSafeEqual(expected, actual)
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendActivationEmail(input: {
  departmentId: string;
  email: string;
  fullName: string;
  activationUrl: string;
  expiresAt: string;
}) {
  let provider;
  try {
    provider = createEmailProvider(process.env, { departmentId: input.departmentId });
  } catch (error) {
    if (error instanceof EmailProviderConfigurationError) {
      throw new Error(
        error.message === "Brevo email delivery is not configured."
          ? "Brevo activation email delivery is not configured."
          : error.message,
      );
    }
    throw error;
  }

  const safeName = escapeHtml(input.fullName || "TracePoint user");
  const safeUrl = escapeHtml(input.activationUrl);
  const expirationLabel = new Date(input.expiresAt).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  );

  const htmlContent = `
<div style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#172033;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
               style="max-width:600px;background:#ffffff;border:1px solid #dfe4ea;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:#172033;padding:28px 32px;text-align:center;">
              <div style="font-size:26px;font-weight:700;color:#ffffff;">TracePoint</div>
              <div style="margin-top:6px;font-size:13px;color:#c8d0dc;letter-spacing:1px;text-transform:uppercase;">
                Operational Accountability
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px;">
              <h1 style="margin:0 0 16px;font-size:24px;color:#172033;">
                Activate your TracePoint account
              </h1>
              <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#465266;">
                Hello ${safeName}, an administrator has created a TracePoint account for you.
                Use the button below to securely create your password.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0;">
                <tr>
                  <td style="border-radius:8px;background:#2f6fed;">
                    <a href="${safeUrl}"
                       style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">
                      Activate Your Account
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#667085;">
                This single-use invitation is valid through ${escapeHtml(expirationLabel)}.
              </p>
              <p style="margin:0;font-size:14px;line-height:1.6;color:#667085;">
                If you were not expecting this invitation, contact your TracePoint administrator.
              </p>
              <div style="margin-top:30px;padding-top:22px;border-top:1px solid #e5e9ef;">
                <p style="margin:0 0 8px;font-size:12px;color:#98a2b3;">
                  Button not working? Copy and paste this link:
                </p>
                <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;">
                  <a href="${safeUrl}" style="color:#2f6fed;text-decoration:none;">${safeUrl}</a>
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e5e9ef;">
              <p style="margin:0;font-size:12px;color:#98a2b3;">
                TracePoint · Operational Accountability
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;

  try {
    await provider.send({
      to: [{ email: input.email, name: input.fullName }],
      subject: "Activate your TracePoint account",
      htmlContent,
      textContent:
        `Activate your TracePoint account by visiting:\n\n` +
        `${input.activationUrl}\n\n` +
        `This single-use invitation is valid through ${expirationLabel}.`,
    });
  } catch (error) {
    if (error instanceof EmailProviderResponseError) {
      throw new Error(
        error.providerMessage ?? `Brevo returned status ${error.status}.`,
      );
    }
    throw error;
  }
}

export async function issueActivationEmail(
  input: IssueActivationInput,
) {
  if(awsNative()){
    const issuedAt=new Date(),expiresAt=new Date(issuedAt.getTime()+ACTIVATION_VALID_DAYS*86400000),tokenId=randomUUID(),secret=randomBytes(32).toString("base64url"),token=`${tokenId}.${secret}`,pool=getPostgresPool(),client=await pool.connect();
    try{
      await client.query("begin");
      await client.query("update public.user_activation_tokens set revoked_at=$1 where department_id=$2 and user_id=$3 and used_at is null and revoked_at is null",[issuedAt.toISOString(),input.departmentId,input.userId]);
      await client.query("insert into public.user_activation_tokens(id,department_id,user_id,token_hash,expires_at,created_by_user_id) values($1,$2,$3,$4,$5,$6)",[tokenId,input.departmentId,input.userId,hashTokenSecret(secret),expiresAt.toISOString(),input.actorUserId]);
      await client.query("commit");
    }catch(error){await client.query("rollback").catch(()=>undefined);throw error;}finally{client.release();}
    const activationUrl=new URL("/activate",input.siteUrl.replace(/\/$/,""));activationUrl.searchParams.set("token",token);
    try{await sendActivationEmail({departmentId:input.departmentId,email:input.email,fullName:input.fullName,activationUrl:activationUrl.toString(),expiresAt:expiresAt.toISOString()});}
    catch(error){await pool.query("update public.user_activation_tokens set revoked_at=now() where id=$1 and used_at is null",[tokenId]).catch(()=>undefined);throw error;}
    return{tokenId,expiresAt:expiresAt.toISOString()};
  }
  const {createAdminClient}=await import("@/lib/supabase/admin");
  // Generated bridge types predate the server-only activation table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const issuedAt = new Date();
  const expiresAt = new Date(
    issuedAt.getTime() +
      ACTIVATION_VALID_DAYS * 24 * 60 * 60 * 1000,
  );

  const tokenId = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const token = `${tokenId}.${secret}`;

  const { error: revokeError } = await admin
    .from("user_activation_tokens")
    .update({ revoked_at: issuedAt.toISOString() })
    .eq("department_id", input.departmentId)
    .eq("user_id", input.userId)
    .is("used_at", null)
    .is("revoked_at", null);

  if (revokeError) throw revokeError;

  const { error: insertError } = await admin
    .from("user_activation_tokens")
    .insert({
      id: tokenId,
      department_id: input.departmentId,
      user_id: input.userId,
      token_hash: hashTokenSecret(secret),
      expires_at: expiresAt.toISOString(),
      created_by_user_id: input.actorUserId,
    });

  if (insertError) throw insertError;

  const activationUrl = new URL(
    "/activate",
    input.siteUrl.replace(/\/$/, ""),
  );
  activationUrl.searchParams.set("token", token);

  try {
    await sendActivationEmail({
      departmentId: input.departmentId,
      email: input.email,
      fullName: input.fullName,
      activationUrl: activationUrl.toString(),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    await admin
      .from("user_activation_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", tokenId)
      .is("used_at", null);

    throw error;
  }

  return {
    tokenId,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function validateActivationToken(token: string) {
  const { tokenId, secret } = parseToken(token);
  if(awsNative()){
    const result=await getPostgresPool().query("select * from tracepoint_auth.activation_context($1)",[tokenId]);
    const row=result.rows[0] as AwsActivationRow|undefined;
    if(!row||row.used_at||row.revoked_at||new Date(row.expires_at).getTime()<=Date.now()||!secureHashMatches(row.token_hash,secret)||!row.membership_active||!['pending_activation','activation_sent'].includes(row.activation_status)||row.identity_state!=="pending"||!row.provider_username){
      throw new Error("This activation link is invalid, expired, or has already been used.");
    }
    return{row,email:row.email.trim().toLowerCase(),fullName:row.full_name.trim()||row.email,userMetadata:{full_name:row.full_name,onboarding_status:"pending_activation"},providerUsername:row.provider_username};
  }
  const {createAdminClient}=await import("@/lib/supabase/admin");
  // Generated bridge types predate the server-only activation table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data, error } = await admin
    .from("user_activation_tokens")
    .select("*")
    .eq("id", tokenId)
    .maybeSingle();

  if (error) throw error;

  const row = data as ActivationRow | null;

  if (
    !row ||
    row.used_at ||
    row.revoked_at ||
    new Date(row.expires_at).getTime() <= Date.now() ||
    !secureHashMatches(row.token_hash, secret)
  ) {
    throw new Error(
      "This activation link is invalid, expired, or has already been used.",
    );
  }

  const { data: membership, error: membershipError } = await admin
    .from("department_memberships")
    .select("department_id,user_id,is_active,activation_status")
    .eq("department_id", row.department_id)
    .eq("user_id", row.user_id)
    .maybeSingle();

  if (membershipError) {
    throw new Error(
      "The invited department membership could not be verified.",
    );
  }

  if (!membership || !membership.is_active) {
    throw new Error(
      "This account no longer requires activation.",
    );
  }

  const { data: userData, error: userError } =
    await admin.auth.admin.getUserById(row.user_id);

  const email = userData.user?.email?.trim().toLowerCase();

  if (userError || !userData.user || !email) {
    throw new Error("The invited account could not be found.");
  }

  const onboardingStatus = String(
    userData.user.user_metadata?.onboarding_status ?? "",
  )
    .trim()
    .toLowerCase();

  if (
    userData.user.email_confirmed_at ||
    onboardingStatus === "activated"
  ) {
    throw new Error(
      "This account no longer requires activation.",
    );
  }

  return {
    row,
    email,
    fullName:
      String(userData.user.user_metadata?.full_name ?? "").trim() ||
      email,
    userMetadata: userData.user.user_metadata ?? {},
  };
}

export async function completeActivation(
  token: string,
  password: string,
) {
  const validation = await validateActivationToken(token);
  if(awsNative()){
    const pool=getPostgresPool(),usedAt=new Date().toISOString();
    const claim=await pool.query("update public.user_activation_tokens set used_at=$1 where id=$2 and used_at is null and revoked_at is null and expires_at>$1 returning id",[usedAt,validation.row.id]);
    if(!claim.rowCount)throw new Error("This activation link has expired or has already been used.");
    try{
      const username=(validation as typeof validation&{providerUsername:string}).providerUsername,directory=getCognitoAdminDirectory();
      await directory.setPermanentPassword(username,password);
      await directory.markEmailVerified(username);
      await pool.query("select tracepoint_auth.finalize_cognito_activation($1)",[validation.row.id]);
    }catch(error){await pool.query("update public.user_activation_tokens set used_at=null where id=$1 and used_at=$2",[validation.row.id,usedAt]).catch(()=>undefined);throw error;}
    return{email:validation.email,userId:validation.row.user_id};
  }
  const {createAdminClient}=await import("@/lib/supabase/admin");
  // Generated bridge types predate the server-only activation table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const usedAt = new Date().toISOString();

  const { data: claimed, error: claimError } = await admin
    .from("user_activation_tokens")
    .update({ used_at: usedAt })
    .eq("id", validation.row.id)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", usedAt)
    .select("id")
    .maybeSingle();

  if (claimError || !claimed) {
    throw new Error(
      "This activation link has expired or has already been used.",
    );
  }

  try {
    const { error: passwordError } =
      await admin.auth.admin.updateUserById(
        validation.row.user_id,
        {
          password,
          email_confirm: true,
          user_metadata: {
            ...validation.userMetadata,
            full_name: validation.fullName,
            onboarding_status: "activated",
          },
        },
      );

    if (passwordError) throw passwordError;

    const { error: membershipError } = await admin
      .from("department_memberships")
      .update({ activation_status: "activated" })
      .eq("department_id", validation.row.department_id)
      .eq("user_id", validation.row.user_id)
      .in("activation_status", [
        "pending_activation",
        "activation_sent",
      ]);

    if (membershipError) throw membershipError;

    await admin
      .from("user_activation_tokens")
      .update({ revoked_at: usedAt })
      .eq("department_id", validation.row.department_id)
      .eq("user_id", validation.row.user_id)
      .neq("id", validation.row.id)
      .is("used_at", null)
      .is("revoked_at", null);

    const { error: auditError } = await admin
      .from("audit_events")
      .insert({
        department_id: validation.row.department_id,
        actor_user_id: validation.row.user_id,
        action: "account_activated",
        entity_type: "department_membership",
        entity_id: validation.row.user_id,
        summary: `${validation.email} activated their TracePoint account.`,
        new_value: {
          activation_status: "activated",
          activation_token_id: validation.row.id,
        },
      });

    if (auditError) throw auditError;
  } catch (error) {
    await admin
      .from("user_activation_tokens")
      .update({ used_at: null })
      .eq("id", validation.row.id)
      .eq("used_at", usedAt);

    throw error;
  }

  return {
    email: validation.email,
    userId: validation.row.user_id,
  };
}
