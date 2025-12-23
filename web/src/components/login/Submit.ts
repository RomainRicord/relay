import type { RouteKey } from "../../routes";

function SubmitEvent(
	e: React.FormEvent<HTMLFormElement>,
	step: "EMAIL" | "A2F" | "ENROLL",
	userInput: { email: string; a2f: string },
	setResult: React.Dispatch<
		React.SetStateAction<{ message: string; code: number }>
	>,
	userId: string | null,
	setConnected: React.Dispatch<React.SetStateAction<boolean>>,
	setUser: React.Dispatch<
		React.SetStateAction<{
			id: string;
			user_id: string;
			email: string;
			kp: CryptoKeyPair | null;
			publicJwk: JsonWebKey | null;
		}>
	>,
	setQr: React.Dispatch<React.SetStateAction<string | null>>,
	setUserId: React.Dispatch<React.SetStateAction<string | null>>,
	setStep: React.Dispatch<React.SetStateAction<"EMAIL" | "A2F" | "ENROLL">>,
	setPage: React.Dispatch<React.SetStateAction<RouteKey>>
) {
	e.preventDefault();

	if (step !== "EMAIL" && userInput.a2f === "") {
		setResult({ message: "2FA code required", code: 400 });
		return;
	}

	if (step === "EMAIL") {
		fetch("/api/login/init", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: userInput.email }),
		})
			.then((res) => res.json())
			.then((data) => {
				if (data.status === "ENROLL") {
					setUserId(data.user_id);
					setQr(data.qr);
					setStep("ENROLL");
					setResult({
						message: "Scan QR Code",
						code: 206,
					});
				} else if (data.status === "A2F_REQUIRED") {
					setUserId(data.user_id);
					setStep("A2F");
					setResult({
						message: "Enter 2FA code",
						code: 206,
					});
				} else {
					setResult({
						message: data.error || "Error",
						code: 400,
					});
				}
			});
		return;
	}

	// STEP A2F ou ENROLL → vérification du code
	fetch("/api/login/verify", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			user_id: userId,
			code: userInput.a2f,
		}),
	})
		.then((res) => res.json())
		.then((data) => {
			if (data.token) {
				localStorage.setItem("jwt", data.token);
				if (data.user_id) {
					localStorage.setItem("user_id", data.user_id);
				}
				setUser({
					id: data.user_id,
					user_id: data.user_id,
					email: userInput.email,
					kp: null,
					publicJwk: null,
				});
				setResult({ message: "Connected", code: 200 });
				setConnected(true);
				setPage("dashboard");
			} else {
				setResult({
					message: data.error || "Invalid code",
					code: 401,
				});
			}
		});
}

export default SubmitEvent;
