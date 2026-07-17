import type { Metadata } from "next";
import type { ReactNode } from "react";

import "../src/index.css";

export const metadata: Metadata = {
  title: "보들 관리자 웹",
  description: "보들 서비스 운영을 위한 관리자 도구",
};

export default function RootLayout({children}: Readonly<{children: ReactNode}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
