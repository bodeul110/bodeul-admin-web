"use client";

import {useEffect} from "react";

import App from "../src/App";
import {initializeFirebaseAppCheck} from "../src/appCheck";

export default function AdminPage() {
  useEffect(() => {
    initializeFirebaseAppCheck();
  }, []);

  return <App />;
}
