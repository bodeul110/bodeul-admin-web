import "server-only";
import {getFirestore, type Firestore} from "firebase-admin/firestore";
import {getFirebaseAdminApp} from "./firebase-admin";
import {withFirebaseManagerListFirestore} from "./firebase-manager-list-reader";
import {assertManagerReviewCredentials} from "./manager-review-credentials";
import {resolveManagerListAuthMode} from "./manager-list-reader-policy";
import type {ManagerDisplayProfile} from "./assignment-manager-directory";

export async function readAssignmentManagerProfiles(uids: readonly string[]) {
  if (resolveManagerListAuthMode(process.env) === "vercel-oidc") {
    return withFirebaseManagerListFirestore((firestore) => readProfiles(firestore, uids));
  }
  assertManagerReviewCredentials(process.env);
  return readProfiles(getFirestore(getFirebaseAdminApp()), uids);
}

async function readProfiles(firestore: Firestore, uids: readonly string[]) {
  const profiles = new Map<string, ManagerDisplayProfile>();
  for (let offset = 0; offset < uids.length; offset += 100) {
    const refs = uids.slice(offset, offset + 100).map((uid) => firestore.collection("users").doc(uid));
    const documents = await firestore.getAll(...refs, {fieldMask: ["name", "email"]});
    for (const document of documents) {
      const data = document.data();
      profiles.set(document.id, {name: typeof data?.name === "string" ? data.name : "",
        email: typeof data?.email === "string" ? data.email : ""});
    }
  }
  return profiles;
}
