// vitest.config.ts
import { defineConfig } from "file:///C:/Users/Msabry/WorkBuddy%20AI/Health-Tracker.WB/node_modules/vitest/dist/config.js";
import path from "node:path";
var __vite_injected_original_dirname = "C:\\Users\\Msabry\\WorkBuddy AI\\Health-Tracker.WB";
var vitest_config_default = defineConfig({
  resolve: {
    alias: { "@": path.resolve(__vite_injected_original_dirname, "./src") }
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts"],
    // A single fork keeps runs deterministic and avoids transient
    // temp-file contention in sandboxed environments.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/core/engine/**", "src/core/time/**"]
    }
  }
});
export {
  vitest_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZXN0LmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXE1zYWJyeVxcXFxXb3JrQnVkZHkgQUlcXFxcSGVhbHRoLVRyYWNrZXIuV0JcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXE1zYWJyeVxcXFxXb3JrQnVkZHkgQUlcXFxcSGVhbHRoLVRyYWNrZXIuV0JcXFxcdml0ZXN0LmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvTXNhYnJ5L1dvcmtCdWRkeSUyMEFJL0hlYWx0aC1UcmFja2VyLldCL3ZpdGVzdC5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlc3QvY29uZmlnJztcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczogeyAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYycpIH0sXG4gIH0sXG4gIHRlc3Q6IHtcbiAgICBlbnZpcm9ubWVudDogJ2pzZG9tJyxcbiAgICBnbG9iYWxzOiB0cnVlLFxuICAgIGluY2x1ZGU6IFsndGVzdHMvKiovKi50ZXN0LnRzJywgJ3Rlc3RzLyoqLyoudGVzdC50c3gnLCAnc3JjLyoqLyoudGVzdC50cyddLFxuICAgIC8vIEEgc2luZ2xlIGZvcmsga2VlcHMgcnVucyBkZXRlcm1pbmlzdGljIGFuZCBhdm9pZHMgdHJhbnNpZW50XG4gICAgLy8gdGVtcC1maWxlIGNvbnRlbnRpb24gaW4gc2FuZGJveGVkIGVudmlyb25tZW50cy5cbiAgICBwb29sOiAnZm9ya3MnLFxuICAgIHBvb2xPcHRpb25zOiB7IGZvcmtzOiB7IHNpbmdsZUZvcms6IHRydWUgfSB9LFxuICAgIGNvdmVyYWdlOiB7XG4gICAgICBwcm92aWRlcjogJ3Y4JyxcbiAgICAgIHJlcG9ydGVyOiBbJ3RleHQnLCAnaHRtbCddLFxuICAgICAgaW5jbHVkZTogWydzcmMvY29yZS9lbmdpbmUvKionLCAnc3JjL2NvcmUvdGltZS8qKiddLFxuICAgIH0sXG4gIH0sXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBNFUsU0FBUyxvQkFBb0I7QUFDelcsT0FBTyxVQUFVO0FBRGpCLElBQU0sbUNBQW1DO0FBR3pDLElBQU8sd0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVM7QUFBQSxJQUNQLE9BQU8sRUFBRSxLQUFLLEtBQUssUUFBUSxrQ0FBVyxPQUFPLEVBQUU7QUFBQSxFQUNqRDtBQUFBLEVBQ0EsTUFBTTtBQUFBLElBQ0osYUFBYTtBQUFBLElBQ2IsU0FBUztBQUFBLElBQ1QsU0FBUyxDQUFDLHNCQUFzQix1QkFBdUIsa0JBQWtCO0FBQUE7QUFBQTtBQUFBLElBR3pFLE1BQU07QUFBQSxJQUNOLGFBQWEsRUFBRSxPQUFPLEVBQUUsWUFBWSxLQUFLLEVBQUU7QUFBQSxJQUMzQyxVQUFVO0FBQUEsTUFDUixVQUFVO0FBQUEsTUFDVixVQUFVLENBQUMsUUFBUSxNQUFNO0FBQUEsTUFDekIsU0FBUyxDQUFDLHNCQUFzQixrQkFBa0I7QUFBQSxJQUNwRDtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
