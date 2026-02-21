#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#include <winsvc.h>

// Helper: convert WCHAR* to std::string (UTF-8)
static std::string WideToUtf8(const WCHAR* wide) {
  if (!wide) return "";
  int len = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
  if (len <= 0) return "";
  std::string result(len - 1, '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide, -1, &result[0], len, nullptr, nullptr);
  return result;
}

// Helper: map dwCurrentState to a string
static const char* StateToString(DWORD state) {
  switch (state) {
    case SERVICE_STOPPED:          return "stopped";
    case SERVICE_START_PENDING:    return "start_pending";
    case SERVICE_STOP_PENDING:     return "stop_pending";
    case SERVICE_RUNNING:          return "running";
    case SERVICE_CONTINUE_PENDING: return "continue_pending";
    case SERVICE_PAUSE_PENDING:    return "pause_pending";
    case SERVICE_PAUSED:           return "paused";
    default:                       return "unknown";
  }
}

// serviceExists(name: string): boolean
Napi::Value ServiceExists(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Service name (string) expected").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string nameUtf8 = info[0].As<Napi::String>().Utf8Value();
  int wlen = MultiByteToWideChar(CP_UTF8, 0, nameUtf8.c_str(), -1, nullptr, 0);
  std::wstring wname(wlen - 1, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, nameUtf8.c_str(), -1, &wname[0], wlen);

  SC_HANDLE hSCManager = OpenSCManagerW(NULL, NULL, SC_MANAGER_CONNECT | SC_MANAGER_ENUMERATE_SERVICE);
  if (!hSCManager) {
    DWORD err = GetLastError();
    if (err == ERROR_ACCESS_DENIED) {
      Napi::Error::New(env, "Access denied opening Service Control Manager").ThrowAsJavaScriptException();
    } else {
      Napi::Error::New(env, "Failed to open Service Control Manager (error " + std::to_string(err) + ")").ThrowAsJavaScriptException();
    }
    return env.Null();
  }

  SC_HANDLE hService = OpenServiceW(hSCManager, wname.c_str(), SERVICE_QUERY_STATUS | SERVICE_QUERY_CONFIG);
  if (!hService) {
    DWORD err = GetLastError();
    CloseServiceHandle(hSCManager);
    if (err == ERROR_SERVICE_DOES_NOT_EXIST) {
      return Napi::Boolean::New(env, false);
    } else if (err == ERROR_ACCESS_DENIED) {
      Napi::Error::New(env, "Access denied opening service '" + nameUtf8 + "'").ThrowAsJavaScriptException();
      return env.Null();
    } else {
      Napi::Error::New(env, "Failed to open service '" + nameUtf8 + "' (error " + std::to_string(err) + ")").ThrowAsJavaScriptException();
      return env.Null();
    }
  }

  CloseServiceHandle(hService);
  CloseServiceHandle(hSCManager);
  return Napi::Boolean::New(env, true);
}

// getServiceStatus(name: string): object
Napi::Value GetServiceStatus(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Service name (string) expected").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string nameUtf8 = info[0].As<Napi::String>().Utf8Value();
  int wlen = MultiByteToWideChar(CP_UTF8, 0, nameUtf8.c_str(), -1, nullptr, 0);
  std::wstring wname(wlen - 1, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, nameUtf8.c_str(), -1, &wname[0], wlen);

  SC_HANDLE hSCManager = OpenSCManagerW(NULL, NULL, SC_MANAGER_CONNECT | SC_MANAGER_ENUMERATE_SERVICE);
  if (!hSCManager) {
    DWORD err = GetLastError();
    if (err == ERROR_ACCESS_DENIED) {
      Napi::Error::New(env, "Access denied opening Service Control Manager").ThrowAsJavaScriptException();
    } else {
      Napi::Error::New(env, "Failed to open Service Control Manager (error " + std::to_string(err) + ")").ThrowAsJavaScriptException();
    }
    return env.Null();
  }

  SC_HANDLE hService = OpenServiceW(hSCManager, wname.c_str(), SERVICE_QUERY_STATUS | SERVICE_QUERY_CONFIG);
  if (!hService) {
    DWORD err = GetLastError();
    CloseServiceHandle(hSCManager);
    if (err == ERROR_SERVICE_DOES_NOT_EXIST) {
      Napi::Object result = Napi::Object::New(env);
      result.Set("name", nameUtf8);
      result.Set("exists", false);
      result.Set("state", "not_found");
      result.Set("pid", 0);
      return result;
    } else if (err == ERROR_ACCESS_DENIED) {
      Napi::Error::New(env, "Access denied opening service '" + nameUtf8 + "'").ThrowAsJavaScriptException();
      return env.Null();
    } else {
      Napi::Error::New(env, "Failed to open service '" + nameUtf8 + "' (error " + std::to_string(err) + ")").ThrowAsJavaScriptException();
      return env.Null();
    }
  }

  SERVICE_STATUS_PROCESS ssp = {};
  DWORD bytesNeeded = 0;
  BOOL ok = QueryServiceStatusEx(hService, SC_STATUS_PROCESS_INFO,
                                  reinterpret_cast<LPBYTE>(&ssp),
                                  sizeof(ssp), &bytesNeeded);

  std::string displayName;
  // Try to get display name via QueryServiceConfigW
  DWORD configBytes = 0;
  QueryServiceConfigW(hService, nullptr, 0, &configBytes);
  if (configBytes > 0) {
    std::vector<BYTE> buf(configBytes);
    LPQUERY_SERVICE_CONFIGW pConfig = reinterpret_cast<LPQUERY_SERVICE_CONFIGW>(buf.data());
    if (QueryServiceConfigW(hService, pConfig, configBytes, &configBytes)) {
      displayName = WideToUtf8(pConfig->lpDisplayName);
    }
  }

  CloseServiceHandle(hService);
  CloseServiceHandle(hSCManager);

  if (!ok) {
    DWORD err = GetLastError();
    Napi::Error::New(env, "QueryServiceStatusEx failed (error " + std::to_string(err) + ")").ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Object result = Napi::Object::New(env);
  result.Set("name", nameUtf8);
  result.Set("exists", true);
  result.Set("state", StateToString(ssp.dwCurrentState));
  result.Set("pid", static_cast<double>(ssp.dwProcessId));
  result.Set("displayName", displayName);
  return result;
}

// listServices(): Array<object>
Napi::Value ListServices(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  SC_HANDLE hSCManager = OpenSCManagerW(NULL, NULL, SC_MANAGER_CONNECT | SC_MANAGER_ENUMERATE_SERVICE);
  if (!hSCManager) {
    DWORD err = GetLastError();
    if (err == ERROR_ACCESS_DENIED) {
      Napi::Error::New(env, "Access denied opening Service Control Manager").ThrowAsJavaScriptException();
    } else {
      Napi::Error::New(env, "Failed to open Service Control Manager (error " + std::to_string(err) + ")").ThrowAsJavaScriptException();
    }
    return env.Null();
  }

  DWORD bytesNeeded = 0;
  DWORD servicesReturned = 0;
  DWORD resumeHandle = 0;

  // First call to get required buffer size
  EnumServicesStatusExW(hSCManager, SC_ENUM_PROCESS_INFO,
                         SERVICE_WIN32, SERVICE_STATE_ALL,
                         nullptr, 0, &bytesNeeded,
                         &servicesReturned, &resumeHandle, nullptr);

  std::vector<BYTE> buf(bytesNeeded);
  BOOL ok = EnumServicesStatusExW(hSCManager, SC_ENUM_PROCESS_INFO,
                                   SERVICE_WIN32, SERVICE_STATE_ALL,
                                   buf.data(), bytesNeeded,
                                   &bytesNeeded, &servicesReturned,
                                   &resumeHandle, nullptr);

  CloseServiceHandle(hSCManager);

  if (!ok) {
    DWORD err = GetLastError();
    Napi::Error::New(env, "EnumServicesStatusExW failed (error " + std::to_string(err) + ")").ThrowAsJavaScriptException();
    return env.Null();
  }

  ENUM_SERVICE_STATUS_PROCESSW* services =
    reinterpret_cast<ENUM_SERVICE_STATUS_PROCESSW*>(buf.data());

  Napi::Array arr = Napi::Array::New(env, servicesReturned);
  for (DWORD i = 0; i < servicesReturned; i++) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("name", WideToUtf8(services[i].lpServiceName));
    obj.Set("displayName", WideToUtf8(services[i].lpDisplayName));
    obj.Set("state", StateToString(services[i].ServiceStatusProcess.dwCurrentState));
    obj.Set("pid", static_cast<double>(services[i].ServiceStatusProcess.dwProcessId));
    obj.Set("exists", true);
    arr.Set(i, obj);
  }

  return arr;
}

#endif // _WIN32

Napi::Object Init(Napi::Env env, Napi::Object exports) {
#ifdef _WIN32
  exports.Set("serviceExists", Napi::Function::New(env, ServiceExists));
  exports.Set("getServiceStatus", Napi::Function::New(env, GetServiceStatus));
  exports.Set("listServices", Napi::Function::New(env, ListServices));
#else
  // On non-Windows platforms, the addon exports nothing useful.
  // The JS layer should not load this addon on non-Windows.
  (void)env;
  (void)exports;
#endif
  return exports;
}

NODE_API_MODULE(service_status, Init)
