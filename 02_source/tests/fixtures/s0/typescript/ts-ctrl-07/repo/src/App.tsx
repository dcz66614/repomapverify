import { Button } from "./Button";
import { useList } from "./hooks/useList.jsx";
export const App = () => { const items = useList(); return <Button label={items[0]} />; };
