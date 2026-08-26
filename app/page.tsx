"use client";

import App from "../src/App";
import {initializeFirebaseAppCheck} from "../src/appCheck";

initializeFirebaseAppCheck();

export default function AdminPage() {
  return <App />;
}
