// Public privacy policy for tracepointhq.com/privacy and the mobile apps.
// Every statement must match verified system behaviour. Items the business
// owner must confirm are marked [[OWNER: ...]]; the accompanying test keeps a
// policy with unresolved markers from passing the build.

export type PolicySection = { id: string; heading: string; paragraphs?: string[]; items?: string[]; closing?: string[] };

export const policyEffectiveDate = "[[OWNER: effective date, e.g. October 20, 2026]]";

export const policyIntro = [
  "This Privacy Policy explains how [[OWNER: confirm legal entity name — TracePoint LLC]] (\"TracePoint,\" \"we,\" \"us\") collects, uses, shares, and protects information through TracePoint Public Safety, which includes the TracePoint website and web application at tracepointhq.com and the TracePoint mobile apps for iOS and Android (together, the \"Service\").",
  "TracePoint is an operations platform for public safety agencies. The Service is provided to agencies and is intended only for authorized agency personnel. It is not a consumer service and is not intended for members of the public.",
];

export const policySections: PolicySection[] = [
  {
    id: "role",
    heading: "1. Our relationship with your agency",
    paragraphs: [
      "Your agency decides who receives an account, which roles and permissions each person has, and what records are kept in the Service. We process the information in your agency's TracePoint workspace to provide the Service to your agency and in accordance with our agreement with your agency. [[OWNER: confirm that agencies act as the controller and TracePoint as service provider/processor, and whether a data processing or CJIS addendum applies]]",
      "If you have questions about records your agency keeps about you, contact your agency administrator first. You can also contact us using the details at the end of this policy.",
    ],
  },
  {
    id: "accounts",
    heading: "2. Who can use the Service",
    paragraphs: [
      "Accounts are created by an authorized administrator of a participating agency. The Service does not offer public sign-up. Sign-in uses Amazon Cognito and requires multi-factor authentication. Your password and authenticator codes are entered on the secure sign-in page and are never entered into or stored by the TracePoint mobile app.",
    ],
  },
  {
    id: "collect",
    heading: "3. Information we collect",
    paragraphs: ["Depending on how your agency uses the Service, we collect the following categories of information:"],
    items: [
      "Account and profile information: name, email address, and, if your agency provides them, phone number, badge number, rank or title, unit, employee number, agency, roles, groups, and account status.",
      "Sign-in and session information: Amazon Cognito account identifiers, records of active sessions, encrypted refresh tokens, and account lifecycle events such as invitations, activations, password resets, and deactivations.",
      "Agency operational records: firearms, assignments, custody events, inspections, and possession restrictions; qualification, training, and certification records, including scores and instructor notes; range-day rosters, attendance, and scoring; equipment and inventory assignments and checkouts; fleet vehicles, inspections, and work orders; off-duty and personal firearm requests; and in-app notifications.",
      "Files you upload: photos, short videos (which may include audio), and documents attached as inspection evidence or records. Files can contain metadata added by your device, such as the date and, if your camera records it, location. [[OWNER: decide whether to strip photo location metadata on upload; if not, keep this sentence]]",
      "Audit records: which user created or changed a record, what changed, and when.",
      "Technical and security information: our hosting provider's security and request logs, which include IP addresses and request details, and error reports used to diagnose problems.",
    ],
  },
  {
    id: "mobile",
    heading: "4. Mobile app permissions and device data",
    items: [
      "Camera: used only when you choose to scan a TracePoint QR code or capture inspection evidence.",
      "Microphone: used only to record audio as part of a short inspection video you choose to capture.",
      "Face ID, Touch ID, or device biometrics: used only to unlock the app on your device. Biometric data is handled by your device's operating system and is never available to TracePoint.",
      "On-device storage: the app keeps your sign-in tokens and selected agency in your device's secure storage and removes them when you sign out. Unsent vehicle inspection drafts are stored on the device until they are submitted.",
      "The app does not collect your precise or approximate location, contacts, or advertising identifiers, does not use push notification tokens, and does not read your photo library.",
      "You can change camera, microphone, and biometric permissions at any time in your device settings.",
    ],
  },
  {
    id: "use",
    heading: "5. How we use information",
    items: [
      "To provide, operate, and maintain the Service for your agency.",
      "To authenticate users, keep accounts secure, and prevent misuse.",
      "To keep audit records that let your agency see who changed what and when.",
      "To send service emails, such as account activation messages and notifications you choose to receive by email.",
      "To provide support, diagnose errors, and improve the reliability of the Service.",
      "To comply with legal obligations and enforce our agreements.",
    ],
    closing: [
      "We do not sell personal information, use it for advertising, or track you across other companies' apps or websites.",
    ],
  },
  {
    id: "share",
    heading: "6. How information is shared",
    items: [
      "Within your agency: with personnel your agency authorizes, according to the roles and permissions your agency assigns.",
      "Service providers: Amazon Web Services, which provides hosting, database, file storage, authentication, email delivery, and security monitoring; and Sentry, which provides error monitoring. Error reports are configured to exclude user identities, cookies, request bodies, and contact details. These providers may process information only to provide services to us.",
      "TracePoint support staff: authorized TracePoint staff may access an agency's workspace to provide support. Support access is recorded in the agency's audit log.",
      "Legal reasons: when required by law, legal process, or to protect the rights, safety, or security of users, agencies, the public, or TracePoint.",
      "Business transfers: as part of a merger, acquisition, or sale of assets, subject to this policy's protections.",
    ],
  },
  {
    id: "cookies",
    heading: "7. Cookies and similar technologies",
    paragraphs: [
      "The website uses only cookies that are necessary for the Service to work: a secure session cookie, a short-lived cookie that protects the sign-in process, and cookies that remember your selected agency. The web application also stores display preferences and in-progress work in your browser's local storage. We do not use advertising or analytics cookies.",
    ],
  },
  {
    id: "security",
    heading: "8. Storage and security",
    paragraphs: [
      "Information is stored with Amazon Web Services in the United States (US East, N. Virginia region). Information is encrypted in transit using TLS and encrypted at rest. Access is restricted by role and agency, sign-in requires multi-factor authentication, and the Service maintains audit logs and security monitoring. No method of transmission or storage is completely secure, but we work to protect information using industry-standard safeguards.",
    ],
  },
  {
    id: "retention",
    heading: "9. Retention",
    paragraphs: [
      "Agency records are kept while your agency uses the Service so your agency can meet its operational and recordkeeping obligations. When a user is deactivated, the account can no longer sign in, and the user's historical records remain part of the agency's records. [[OWNER: state how long agency data is kept after an agency's contract ends and how it is deleted or returned]]",
      "Some information is kept for limited periods for security and recovery: database backups for up to 35 days, application logs for up to 90 days, and earlier versions of uploaded files for up to 365 days.",
    ],
  },
  {
    id: "rights",
    heading: "10. Your choices and rights",
    paragraphs: [
      "You can ask to access, correct, or delete your personal information, or ask to have your account closed. Because your agency controls its records, we may need to refer your request to your agency or confirm it with your agency first. Some records may need to be kept to meet your agency's legal or recordkeeping obligations. To make a request, contact your agency administrator or email us at [[OWNER: privacy contact email, e.g. privacy@tracepointhq.com]]. We will respond as required by applicable law.",
    ],
  },
  {
    id: "children",
    heading: "11. Children",
    paragraphs: [
      "The Service is intended only for authorized personnel of public safety agencies and is not directed to children. We do not knowingly collect personal information from children under 13.",
    ],
  },
  {
    id: "changes",
    heading: "12. Changes to this policy",
    paragraphs: [
      "We may update this policy from time to time. When we do, we will change the effective date above and, for material changes, [[OWNER: how users are notified, e.g. notify agency administrators by email or in the Service]].",
    ],
  },
  {
    id: "contact",
    heading: "13. Contact us",
    paragraphs: [
      "Questions about this policy or our privacy practices can be sent to [[OWNER: privacy contact email]] or support@tracepointhq.com.",
      "[[OWNER: legal entity name and mailing address]]",
    ],
  },
];

export function policyText() {
  return [policyEffectiveDate, ...policyIntro, ...policySections.flatMap(section => [section.heading, ...(section.paragraphs ?? []), ...(section.items ?? []), ...(section.closing ?? [])])].join("\n");
}

export function unresolvedPolicyMarkers(text = policyText()) {
  return text.match(/\[\[OWNER:[^\]]*\]\]/g) ?? [];
}

// A production build renders this page statically, so an unfinished policy
// fails the image build instead of being published. Development renders the
// draft, markers included, for review.
export function assertPolicyPublishable(environment: string | undefined, text = policyText()) {
  const markers = unresolvedPolicyMarkers(text);
  if (environment === "production" && markers.length) {
    throw new Error(`Privacy policy has ${markers.length} unresolved owner confirmation(s); it cannot be published.`);
  }
}
