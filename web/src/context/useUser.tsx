// src/hooks/useAuth/AuthProvider.tsx
import { createContext, useContext, useState } from "react";

import type { RouteKey } from "../routes";

type AppUser = {
	id: string;
	user_id: string;
	email: string;
};

export type AuthContextType = {
	user: AppUser;
	setUser: React.Dispatch<React.SetStateAction<AppUser>>;
	userInput?: { email: string; a2f: string };
	setUserInput?: React.Dispatch<
		React.SetStateAction<{ email: string; a2f: string }>
	>;
	connected?: boolean;
	setConnected?: React.Dispatch<React.SetStateAction<boolean>>;
	page?: RouteKey;
	setPage: React.Dispatch<React.SetStateAction<RouteKey>>;
	result?: { message: string; code: number };
	step?: "EMAIL" | "A2F" | "ENROLL";
	userId?: string | null;
	qr?: string | null;
	setResult?: React.Dispatch<
		React.SetStateAction<{ message: string; code: number }>
	>;
	setStep?: React.Dispatch<React.SetStateAction<"EMAIL" | "A2F" | "ENROLL">>;
	setUserId?: React.Dispatch<React.SetStateAction<string | null>>;
	setQr?: React.Dispatch<React.SetStateAction<string | null>>;

	// ... (other context values and functions)
};

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [user, setUser] = useState<AppUser>({} as AppUser);
	const [userInput, setUserInput] = useState({ email: "", a2f: "" });
	const [connected, setConnected] = useState(false);
	const [page, setPage] = useState<RouteKey>("login");
	const [result, setResult] = useState({ message: "", code: 0 });
	const [step, setStep] = useState<"EMAIL" | "A2F" | "ENROLL">("EMAIL");
	const [userId, setUserId] = useState<string | null>(null);
	const [qr, setQr] = useState<string | null>(null);

	return (
		<AuthContext.Provider
			value={{
				user,
				setUser,
				userInput,
				setUserInput,
				connected,
				setConnected,
				page,
				setPage,
				result,
				step,
				userId,
				qr,
				setResult,
				setStep,
				setUserId,
				setQr,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

export const useAuth = (): AuthContextType => {
	const context = useContext(AuthContext);
	if (context === null) {
		throw new Error("useAuthContext must be used within an AuthProvider");
	}
	return context;
};
