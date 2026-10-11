import { useEffect, useState } from "react";
import { agendaToday } from "./clock";

/** Se actualiza al pasar la medianoche en Bogotá, sin recargar a mano. */
export function useAgendaToday(): string {
  const [day, setDay] = useState(agendaToday);
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = agendaToday();
      setDay((prev) => (prev === next ? prev : next));
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  return day;
}
