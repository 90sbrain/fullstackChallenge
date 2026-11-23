import { graphql, HttpResponse } from "msw";
import userEvent from "@testing-library/user-event";
import { server } from "@/mocks/server";
import { db } from "@/mocks/db";
import { apolloClient } from "@/lib/apollo";
import { renderWithProviders, screen } from "@/test/renderWithProviders";
import { CarsPage } from "@/features/cars/pages/CarsPage";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  db.reset();
  apolloClient.cache.reset();
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => server.close());

describe("CarsPage", () => {
  it("shows the general empty state when the inventory has no cars", async () => {
    server.use(
      graphql.query("GetCars", () =>
        HttpResponse.json({ data: { cars: [] } })
      )
    );
    renderWithProviders(<CarsPage />);

    expect(await screen.findByText("0 vehicles available")).toBeInTheDocument();
    expect(
      await screen.findByText("There are no vehicles in the inventory yet.")
    ).toBeInTheDocument();
  });

  it("shows a loading state while the inventory is requested", () => {
    renderWithProviders(<CarsPage />);

    expect(screen.getByRole("status", { name: "Loading vehicles" })).toBeInTheDocument();
  });

  it("shows an empty state when the search has no matches", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CarsPage />);

    expect(
      await screen.findByText("6 vehicles available")
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "Search model" }),
      "no-such-model"
    );
    expect(
      await screen.findByText(
        "No vehicles match “no-such-model”. Try another model."
      )
    ).toBeInTheDocument();
  }, 10_000);

  it("waits for the user to pause typing before requesting filtered results", async () => {
    let requestCount = 0;
    server.use(
      graphql.query("GetCars", ({ variables }) => {
        requestCount += 1;
        const model = String(variables.model ?? "").toLowerCase();
        return HttpResponse.json({
          data: {
            cars: db
              .list()
              .filter((car) => car.model.toLowerCase().includes(model)),
          },
        });
      })
    );

    renderWithProviders(<CarsPage />);
    expect(await screen.findByText("6 vehicles available")).toBeInTheDocument();
    expect(requestCount).toBe(1);

    await userEvent.type(
      screen.getByRole("textbox", { name: "Search model" }),
      "Q5"
    );
    expect(requestCount).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(requestCount).toBe(1);

    expect(await screen.findByText("1 vehicle available")).toBeInTheDocument();
    expect(requestCount).toBe(2);
  });

  it("shows a useful message when the inventory request fails", async () => {
    server.use(
      graphql.query("GetCars", () =>
        HttpResponse.json({ errors: [{ message: "Inventory unavailable" }] })
      )
    );
    renderWithProviders(<CarsPage />);

    expect(
      await screen.findByText(
        "Could not load vehicles: Inventory unavailable"
      )
    ).toBeInTheDocument();
  });

  it("changes inventory order when the year sort is changed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CarsPage />);

    expect(await screen.findByRole("heading", { name: "e-tron GT" })).toBeInTheDocument();
    const inventory = screen.getByRole("region", { name: "The collection" });
    const modelsInOrder = () =>
      Array.from(inventory.querySelectorAll("h2:not(#inventory-title)")).map(
        (heading) => heading.textContent
      );

    expect(modelsInOrder()).toEqual(["e-tron GT", "R8", "Q3", "Q5", "A3", "A6"]);
    await user.click(screen.getByRole("combobox", { name: /Sort by year/ }));
    await user.click(await screen.findByRole("option", { name: "Oldest first" }));

    expect(modelsInOrder()).toEqual(["A6", "A3", "Q5", "R8", "Q3", "e-tron GT"]);
  });

  it("keeps the form values and reports an error when vehicle creation fails", async () => {
    const user = userEvent.setup();
    server.use(
      graphql.mutation("CreateCar", () =>
        HttpResponse.json({
          errors: [{ message: "Vehicle could not be saved" }],
        })
      )
    );
    renderWithProviders(<CarsPage />);

    await user.type(screen.getByRole("textbox", { name: "Make" }), "Audi");
    await user.type(screen.getByRole("textbox", { name: "Model" }), "A8");
    await user.type(screen.getByRole("textbox", { name: "Color" }), "Black");
    await user.click(screen.getByRole("button", { name: "Add vehicle" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not add vehicle: Vehicle could not be saved"
    );
    expect(screen.getByRole("textbox", { name: "Make" })).toHaveValue("Audi");
    expect(screen.getByRole("textbox", { name: "Model" })).toHaveValue("A8");
    expect(screen.getByRole("textbox", { name: "Color" })).toHaveValue("Black");
  });
});
