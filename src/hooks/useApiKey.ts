import { useState } from "react";
import { useApiKeyStore } from "../store/useApiKeyStore";

export function useApiKey() {
  const [inputValue, setInputValue] = useState("");
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  const { apiTested, apiKey, testApiConnection } = useApiKeyStore();

  async function handleTest() {
    if (!inputValue.trim()) return;
    setTesting(true);
    setError("");
    try {
      await testApiConnection(inputValue.trim());
    } catch (err) {
      setError("Connection failed: " + (err as Error).message);
    } finally {
      setTesting(false);
    }
  }

  return {
    inputValue,
    setInputValue,
    testing,
    error,
    handleTest,
    apiTested,
    apiKey,
  };
}
