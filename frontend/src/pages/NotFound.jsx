import { Link } from "react-router-dom";
import { Empty } from "../components/ui";

export default function NotFound() {
  return (
    <Empty title="Nothing here">
      That page does not exist. <Link to="/">Back to inspections</Link>
    </Empty>
  );
}
