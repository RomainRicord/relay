import "./App.css";

import { AuthProvider } from "./context/useUser";
import Main from "./pages/Home";

// Tailwind

const App = () => {
	return (
		<AuthProvider>
			<Main />
		</AuthProvider>
	);
};

export default App;
