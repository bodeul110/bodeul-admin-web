import {assertDeploymentBoundary} from "../server/deployment-boundary.ts";

// Next 설정 로더의 CommonJS·ESM 차이에 영향을 받지 않게 빌드 전에 검사한다.
assertDeploymentBoundary(process.env);
